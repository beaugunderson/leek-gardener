#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const { sortBy } = require('lodash');
const { Option, program } = require('commander');

const items = require('./items.json');

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

program.addOption(new Option('--leek <number>').argParser(parseBase10).default(1));

program.parse();

const options = program.opts();

let farmerId;
let leeks;

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

(async function main() {
  console.log('Logging in...');
  await login();

  console.log(`Logged in as farmer ${farmerId} with leeks ${leeks.join(', ')}.`);

  const leek = leeks[options.leek - 1];

  const { registers } = await get(`https://leekwars.com/api/leek/get-registers/${leek}`);
  const output = {};

  for (const register of registers) {
    output[register.key] = {};

    if (register.value.includes(':')) {
      const json = JSON.parse(register.value);

      for (const key of Object.keys(json)) {
        if (json[key] === 0) {
          continue;
        }

        const { name } = items[key];

        output[register.key][name] = json[key];
      }
    } else {
      output[register.key] = parseInt(register.value, 10);
    }
  }

  console.log(output);
})();
