#!/bin/bash

/root/.nvm/versions/node/v16.15.0/bin/node ./leek-gardener.js --type team --fights 20 --login 1
/root/.nvm/versions/node/v16.15.0/bin/node ./leek-gardener.js --type farmer --fights 50 --login 1

/root/.nvm/versions/node/v16.15.0/bin/node ./leek-gardener.js --type solo --fights 50 --login 2

# node ./leek-gardener.js --type solo --leek 1 --fights 50
