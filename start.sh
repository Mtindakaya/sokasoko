#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 18
find node_modules -path "*/node_modules/express/package.json" | xargs grep -l '"version": "5' 2>/dev/null | sed 's/\/package.json//' | xargs -I{} rm -rf {}
find node_modules -mindepth 3 -maxdepth 4 -name "express" -type d | xargs -I{} cp -rf node_modules/express {} 2>/dev/null
npm run dev
