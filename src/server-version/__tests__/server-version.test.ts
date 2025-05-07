import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync, execSync } from 'child_process';
import { getServerVersion } from '../index';
import { isDebugging } from '../../helpers';

const scriptFilePath = path.resolve('bin/api-toolkit-git-info.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp'));

describe('getServerVersion does not throw when debugging', () => {
  let debuggingEnabled: boolean;
  let originalEnv: string | undefined;

  beforeAll(() => {
    debuggingEnabled = isDebugging();
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'prod';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test('getServerVersion does not throw when debugging', () => {
    if (!debuggingEnabled) {
      console.log(`Skipping test because debugging is not enabled.`);
      return;
    }
    const version = getServerVersion();
    expect(version.branch).toBe('debugging');
  });
});

describe('git info script', () => {
  test('error when git repo data not available', () => {
    const result = spawnSync(`node "${scriptFilePath}"`, {
      cwd: tempDir,
      shell: true,
      encoding: 'utf8',
    });
    expect(result.status).toStrictEqual(1);
    expect(result.stderr).toEqual(expect.stringContaining('not a git repository'));
  });

  test('error when no git tags found', () => {
    execSync(
      'git init && git config user.name test && git config user.email test && git commit --allow-empty -n -m test',
      { cwd: tempDir }
    );
    const result = spawnSync(`node "${scriptFilePath}"`, {
      cwd: tempDir,
      shell: true,
      encoding: 'utf8',
    });
    expect(result.status).toStrictEqual(1);
    expect(result.stderr).toEqual(expect.stringContaining('no tag found'));
  });

  test('generates get info file correctly', () => {
    execSync(
      'git init && git config user.name test && git config user.email test && git commit --allow-empty -n -m test && git tag v1.2.3 && git branch -m my_branch',
      { cwd: tempDir }
    );
    const result = spawnSync(`node "${scriptFilePath}"`, {
      cwd: tempDir,
      shell: true,
      encoding: 'utf8',
    });
    expect(result.status).toStrictEqual(0);
    const gitInfoFilePath = path.join(tempDir, '.git-info');
    expect(fs.existsSync(gitInfoFilePath));
    const gitInfoContent = fs.readFileSync(gitInfoFilePath, { encoding: 'utf8' });
    const gitInfoParts = gitInfoContent.split('\n');
    expect(gitInfoParts[0]).toStrictEqual('my_branch');
    expect(gitInfoParts[1]).toBeTruthy();
    expect(gitInfoParts[2]).toStrictEqual('v1.2.3');
  });
});
