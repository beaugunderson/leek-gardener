#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const { isFinite, sortBy } = require('lodash');
const { Option, program } = require('commander');

const { LOGIN } = process.env;
const { PASSWORD } = process.env;

function sleep(ms) {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => setTimeout(resolve, ms));
}

axios.interceptors.response.use(
  (response) => response,

  async (error) => {
    console.log({ error });

    if (error.response?.status === 429) {
      console.error('Rate limited...');
      await sleep(2500);
      return axios.request(error.config);
    }

    return Promise.reject(error);
  },
);

function parseBase10(number) {
  return parseInt(number, 10);
}

program
  .addOption(new Option('--leek <number>').argParser(parseBase10).default(1))
  .addOption(new Option('--fights <number>').argParser(parseBase10).default(10))
  .addOption(new Option('--max-elo').default(false));

program.parse();

const options = program.opts();

let farmerId;
let leeks;

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
      } else {
        record[opponent.id] -= 0.5;
      }
    }
  }
}

async function getRecord(leek) {
  const history = await getHistory(leek);

  for (const fight of history.fights) {
    updateRecord(fight, leek);
  }
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

  const { farmer } = await get('https://leekwars.com/api/farmer/get-from-token');

  farmerId = farmer.id;
  leeks = sortBy(Object.keys(farmer.leeks));
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
  try {
    return await get(`https://leekwars.com/api/fight/get/${fightId}`);
  } catch (e) {
    console.error(e.message);
    return null;
  }
}

(async function main() {
  console.log('Logging in...');
  await login();

  console.log(`Logged in as farmer ${farmerId} with leeks ${leeks.join(', ')}.`);

  console.log('Getting remaining fights...');
  let fights = await remainingFights();
  console.log(`${fights} remaining fights.`);
  fights = Math.min(fights, options.fights);
  console.log(`Using ${options.fights} fights.`);

  if (fights === 0) {
    process.exit(0);
  }

  const leek = leeks[options.leek - 1];

  console.log('Getting record...');
  await getRecord(leek);

  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (let i = 0; i < fights; i++) {
    const { cookies, enemies } = await getEnemies(leek);

    const sortedEnemies = sortBy(enemies, [
      (enemy) => -(record[enemy.id] ?? 0),
      (enemy) => (options.maxElo ? -enemy.talent : enemy.talent),
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
    console.log(`Fighting ${enemy.name} (${i + 1}/${fights}) [${wins}/${losses}/${draws}]...`);

    const { fight } = await startFight(leek, enemy.id, cookies);

    let result = await getResult(fight);

    while (!result || result.winner === -1) {
      console.log('Waiting for fight to run...');

      await sleep(1000);

      result = await getResult(fight);
    }

    let us;
    let them;

    if (result.farmers1[farmerId]) {
      us = 1;
      them = 2;
    } else if (result.farmers2[farmerId]) {
      us = 2;
      them = 1;
    }

    if (!isFinite(record[enemy.id])) {
      record[enemy.id] = 0;
    }

    if (result.winner === us) {
      record[enemy.id]++;
      wins++;
      console.log('We won!');
    } else if (result.winner === them) {
      record[enemy.id]--;
      losses++;
      console.log('We lost.');
    } else {
      record[enemy.id] -= 0.5;
      draws++;
      console.log('We drew.');
    }

    await sleep(2500);
  }

  console.log(`${wins} wins, ${losses} losses, ${draws} draws.`);
})();
