#!/bin/bash

alias node=/root/.nvm/versions/node/v16.15.0/bin/node

node ./leek-gardener.js --type farmer --fights 50
node ./leek-gardener.js --type register
node ./leek-gardener.js --type team --fights 20

# node ./leek-gardener.js --type solo --leek 1 --fights 50
