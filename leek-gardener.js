#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const { isFinite, sortBy } = require('lodash');

const FARMER_ID = parseInt(process.env.FARMER_ID, 10);
const LEEKS = process.env.LEEKS.split(',').map((leek) => parseInt(leek, 10));

const { LOGIN } = process.env;
const { PASSWORD } = process.env;

async function getHistory(leek) {
  return (await axios.get(`https://leekwars.com/api/history/get-leek-history/${leek}`)).data;
}

const record = {};

function updateRecord(fight, myLeek) {
  // ignore team fights for now
  if (fight.type === 2) {
    return;
  }

  const opponentSides = [fight.leeks1, fight.leeks2].filter((side) =>
    side.every((leek) => leek.id !== myLeek),
  );

  for (const side of opponentSides) {
    for (const opponent of side) {
      if (!isFinite(record[opponent.id])) {
        record[opponent.id] = 0;
      }

      if (fight.result === 'win') {
        record[opponent.id]++;
      } else if (fight.result === 'defeat') {
        record[opponent.id]--;
      }
    }
  }
}

async function getRecord(leek) {
  const history = await getHistory(leek);

  for (const fight of history.fights) {
    updateRecord(fight, leek);
  }

  return record;
}

let token;

async function post(url, data) {
  return (
    await axios.post(url, data, {
      headers: {
        Cookie: `token=${token}`,
        'Content-Type': 'multipart/form-data',
      },
    })
  ).data;
}

async function get(url) {
  return (await axios.get(url, { headers: { Cookie: `token=${token}` } })).data;
}

async function login() {
  const response = await post('https://leekwars.com/api/farmer/login-token', {
    login: LOGIN,
    password: PASSWORD,
  });

  token = response.token;
}

async function remainingFights() {
  return (await get('https://leekwars.com/api/garden/get')).garden.fights;
}

async function getEnemies(leek) {
  const response = await axios.get(`https://leekwars.com/api/garden/get-leek-opponents/${leek}`, {
    headers: { Cookie: `token=${token}` },
  });

  const cookies = response.headers['set-cookie'].map((cookie) => cookie.split('; ')[0]).join('; ');

  return {
    cookies,
    enemies: response.data.opponents,
  };
}

async function startFight(leek, enemy, cookies) {
  const response = await axios.post(
    'https://leekwars.com/api/garden/start-solo-fight',

    {
      leek_id: leek,
      target_id: enemy,
    },

    {
      headers: {
        Cookie: cookies,
        'Content-Type': 'multipart/form-data',
      },
    },
  );

  return response.data;
}

async function getResult(fightId) {
  const fight = await get(`https://leekwars.com/api/fight/get/${fightId}`);

  return fight;
}

function sleep(ms) {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async function main() {
  console.log('Logging in...');
  await login();

  console.log('Getting remaining fights...');
  const fights = await remainingFights();

  const leek = LEEKS[0];

  console.log('Getting record...');
  await getRecord(leek);

  for (let i = 0; i < fights; i++) {
    const { cookies, enemies } = await getEnemies(leek);

    const sortedEnemies = sortBy(enemies, [
      (enemy) => -(record[enemy.id] ?? 0),
      (enemy) => enemy.talent,
    ]);

    console.log();

    for (const enemy of sortedEnemies) {
      console.log(
        enemy.name.padEnd(20, ' '),
        `${record[enemy.id] ?? 0}`.padStart(8, ' '),
        enemy.talent,
      );
    }

    const enemy = sortedEnemies[0];

    console.log();
    console.log(`Fighting ${enemy.name}...`);

    const { fight } = await startFight(leek, enemy.id, cookies);

    let result = await getResult(fight);

    while (!result || result.winner === -1) {
      console.log('Waiting for fight to run...');
      await sleep(1000);
      result = await getResult(fight);
    }

    let us;

    if (result.farmers1[FARMER_ID]) {
      us = 1;
    } else if (result.farmers2[FARMER_ID]) {
      us = 2;
    }

    if (!isFinite(record[enemy.id])) {
      record[enemy.id] = 0;
    }

    if (result.winner === us) {
      record[enemy.id]++;
      console.log('We won!');
    } else {
      record[enemy.id]--;
      console.log('We lost.');
    }

    await sleep(1000);
  }
})();
