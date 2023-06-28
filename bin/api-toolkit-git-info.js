#!/usr/bin/env node

const child_process = require('child_process');
const fs = require('fs');

try {
  child_process.execSync('git --version');
} catch (error) {
  console.error(error.message);
  throw new Error(`git is missing, please install git and retry`);
}
const gitInfo = [
  'git rev-parse --abbrev-ref HEAD',
  'git log -1 --pretty=format:%h',
  'git describe --tags --abbrev=0',
].map((r, index) => {
  try {
    return child_process.execSync(r, { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error(error.message);
    if (index === 2) throw new Error(`no tag found fetch tags by running "git fetch --all --tags"`);
    throw error;
  }
});
fs.writeFileSync('.git-info', gitInfo.join('\n'));
