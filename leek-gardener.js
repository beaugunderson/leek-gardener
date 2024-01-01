#!/usr/bin/env node

/* eslint-disable max-classes-per-file */

require('dotenv').config();

const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { isFinite, sortBy } = require('lodash');
const { Option, program } = require('commander');
const { wrapper } = require('axios-cookiejar-support');

const { LOGIN } = process.env;
const { PASSWORD } = process.env;

function sleep(ms) {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const jar = new CookieJar();

const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
  }),
);

client.interceptors.response.use(
  (response) => response,

  async (error) => {
    if (error.response?.status === 429) {
      console.error('Rate limited...');
      await sleep(2500);
      return client.request(error.config);
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
  .addOption(new Option('--type <type>').default('solo'))
  .addOption(new Option('--max-elo').default(false))
  .addOption(new Option('--dry-run').default(false));

program.parse();

const options = program.opts();

async function post(url, data, headers = {}) {
  if (!(data instanceof URLSearchParams)) {
    // eslint-disable-next-line no-param-reassign
    headers['Content-Type'] = 'multipart/form-data';
  }

  return client.post(url, data, { headers });
}

async function get(url) {
  return (await client.get(url)).data;
}

class Connectivity {
  async login() {
    try {
      await post('https://leekwars.com/api/farmer/login-token', {
        login: LOGIN,
        password: PASSWORD,
      });

      const { farmer } = await get('https://leekwars.com/api/farmer/get-from-token');

      this.farmerId = farmer.id;

      this.leeks = sortBy(Object.keys(farmer.leeks));
      this.leek = this.leeks[options.leek - 1];
    } catch (e) {
      console.error('Failed login:', e.toJSON());
      process.exit(1);
    }
  }
}

class Register extends Connectivity {
  async main() {
    await this.login();

    // only one leek can be auto-registered; let's use our best leek
    const leek = this.leeks[0];

    console.log(`Registering "${leek}"...`);

    try {
      const response = await post(
        'https://leekwars.com/api/leek/register-auto-br',
        new URLSearchParams({ leek_id: leek }),
        {
          Authorization: 'Bearer $',
          Referer: `https://leekwars.com/leek/${leek}`,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      );
      console.log('Success', response.data);
    } catch (e) {
      console.log('Failed to register:', e.message);
    }
  }
}

class Fights extends Connectivity {
  constructor() {
    super();

    this.fightParameters = () => ({});
    this.record = {};
  }

  async remainingFights() {
    return (await get('https://leekwars.com/api/garden/get')).garden.fights;
  }

  async getEnemies() {
    const response = await client.get(this.enemiesUrl());

    const enemies = sortBy(response.data?.opponents ?? [], this.SORT_ENEMIES);

    return {
      enemies,
    };
  }

  async getResult(fightId) {
    try {
      return await get(`https://leekwars.com/api/fight/get/${fightId}`);
    } catch (e) {
      console.error(e.message);
      return null;
    }
  }

  async startFight(enemy) {
    const response = await post(this.fightUrl, { ...this.fightParameters(), target_id: enemy });

    return response.data;
  }
}

class SoloFights extends Fights {
  SORT_ENEMIES = [
    (enemy) => -(this.record[enemy.id] ?? 0),
    (enemy) => (options.maxElo ? -enemy.talent : enemy.talent),
  ];

  constructor() {
    super();

    this.enemiesUrl = () => `https://leekwars.com/api/garden/get-leek-opponents/${this.leek}`;

    this.fightParameters = () => ({ leek_id: this.leek });
    this.fightUrl = 'https://leekwars.com/api/garden/start-solo-fight';
  }

  async getHistory() {
    return get(`https://leekwars.com/api/history/get-leek-history/${this.leek}`);
  }

  async updateRecord() {
    const history = await this.getHistory();

    for (const fight of history.fights) {
      if (fight.type !== 0) {
        continue;
      }

      const opponentSides = [fight.leeks1, fight.leeks2].filter((side) =>
        side.every((leek) => leek.id !== this.leek),
      );

      for (const side of opponentSides) {
        for (const opponent of side) {
          if (!isFinite(this.record[opponent.id])) {
            this.record[opponent.id] = 0;
          }

          if (fight.result === 'win') {
            this.record[opponent.id]++;
          } else if (fight.result === 'defeat') {
            this.record[opponent.id]--;
          } else {
            this.record[opponent.id] -= 0.5;
          }
        }
      }
    }
  }
}

class FarmerFights extends Fights {
  SORT_ENEMIES = [
    (enemy) => -(this.record[enemy.id] ?? 0),
    (enemy) => (options.maxElo ? -enemy.talent : enemy.talent),
    (enemy) => enemy.total_level / enemy.leek_count,
  ];

  enemiesUrl() {
    return 'https://leekwars.com/api/garden/get-farmer-opponents';
  }

  fightUrl = 'https://leekwars.com/api/garden/start-farmer-fight';

  async getHistory() {
    return get(`https://leekwars.com/api/history/get-farmer-history/${this.farmerId}`);
  }

  async updateRecord() {
    const history = await this.getHistory();

    for (const fight of history.fights) {
      if (fight.type !== 1) {
        continue;
      }

      const opponent = fight.farmer1 === this.farmerId ? fight.farmer2 : fight.farmer1;

      if (!isFinite(this.record[opponent])) {
        this.record[opponent] = 0;
      }

      if (fight.result === 'win') {
        this.record[opponent]++;
      } else if (fight.result === 'defeat') {
        this.record[opponent]--;
      } else {
        this.record[opponent] -= 0.5;
      }
    }
  }
}

class TeamFights extends Fights {
  // TODO handle compositions
  SORT_ENEMIES = [
    (enemy) => -(this.record[enemy.id] ?? 0),
    (enemy) => (options.maxElo ? -enemy.talent : enemy.talent),
    (enemy) => (options.maxElo ? -enemy.level : enemy.level),
    (enemy) => enemy.total_level / enemy.leek_count,
  ];

  constructor() {
    super();

    this.compositionId = 26078; // TODO
    this.teamId = 8876; // TODO

    this.enemiesUrl = () =>
      `https://leekwars.com/api/garden/get-composition-opponents/${this.compositionId}`;

    this.fightParameters = () => ({ composition_id: this.compositionId });
    this.fightUrl = 'https://leekwars.com/api/garden/start-team-fight';
  }

  async remainingFights() {
    return (await get('https://leekwars.com/api/garden/get')).garden.team_fights;
  }

  async getHistory() {
    return get(`https://leekwars.com/api/history/get-team-history/${this.teamId}`);
  }

  async updateRecord() {
    const history = await this.getHistory();

    for (const fight of history.fights) {
      if (fight.type !== 1) {
        continue;
      }

      const opponent = fight.team1 === this.teamId ? fight.team2 : fight.team1;

      if (!isFinite(this.record[opponent])) {
        this.record[opponent] = 0;
      }

      if (fight.result === 'win') {
        this.record[opponent]++;
      } else if (fight.result === 'defeat') {
        this.record[opponent]--;
      } else {
        this.record[opponent] -= 0.5;
      }
    }
  }
}

const TYPE_MAPPING = {
  farmer: FarmerFights,
  solo: SoloFights,
  team: TeamFights,
  register: Register,
};

(async () => {
  const manager = new TYPE_MAPPING[options.type]();

  console.log('Logging in...');
  await manager.login();

  if (manager.main) {
    await manager.main();
    return;
  }

  console.log(`Logged in as farmer ${manager.farmerId} with leeks ${manager.leeks.join(', ')}.`);

  console.log('Getting remaining fights...');
  let fights = await manager.remainingFights();
  console.log(`${fights} remaining fights.`);
  fights = Math.min(fights, options.fights);
  console.log(`Using ${options.fights} fights.`);

  if (fights === 0) {
    process.exit(0);
  }

  console.log('Getting record...');
  await manager.updateRecord();

  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (let i = 0; i < fights; i++) {
    const { enemies } = await manager.getEnemies();

    console.log();

    for (const enemy of enemies) {
      console.log(
        enemy.name.padEnd(20, ' '),
        `${manager.record[enemy.id] ?? 0}`.padStart(8, ' '),
        enemy.talent,
        enemy.total_level
          ? `${enemy.total_level} / ${enemy.leek_count} (${(
              enemy.total_level / enemy.leek_count
            ).toFixed(2)})`
          : '',
      );
    }

    const enemy = enemies[0];

    console.log();
    console.log(`Fighting ${enemy.name} (${i + 1}/${fights}) [${wins}/${losses}/${draws}]...`);

    if (options.dryRun) {
      continue;
    }

    const { fight } = await manager.startFight(enemy.id);

    let result = await manager.getResult(fight);

    while (!result || result.winner === -1) {
      console.log('Waiting for fight to run...');

      await sleep(1000);

      result = await manager.getResult(fight);
    }

    let us;
    let them;

    if (result.farmers1[manager.farmerId]) {
      us = 1;
      them = 2;
    } else if (result.farmers2[manager.farmerId]) {
      us = 2;
      them = 1;
    }

    if (!isFinite(manager.record[enemy.id])) {
      manager.record[enemy.id] = 0;
    }

    if (result.winner === us) {
      manager.record[enemy.id]++;
      wins++;
      console.log('We won!');
    } else if (result.winner === them) {
      manager.record[enemy.id]--;
      losses++;
      console.log('We lost.');
    } else {
      manager.record[enemy.id] -= 0.5;
      draws++;
      console.log('We drew.');
    }

    await sleep(2500);
  }

  console.log(`${wins} wins, ${losses} losses, ${draws} draws.`);
})();
