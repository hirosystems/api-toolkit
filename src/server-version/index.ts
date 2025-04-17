import { readFileSync } from 'node:fs';
import { isDebugging } from '../helpers/is-debugging';

interface ServerVersion {
  branch: string;
  commit: string;
  tag: string;
}

export function getServerVersion(): ServerVersion {
  if (process.env.NODE_ENV === 'test') {
    return {
      branch: 'test',
      commit: '123456',
      tag: 'v0.0.1',
    };
  }

  try {
    const [branch, commit, tag] = readFileSync('.git-info', 'utf-8').split('\n');
    return { branch, commit, tag };
  } catch (error: unknown) {
    // If .git-info file does not exist and we are debugging, return a default version
    const fileNotExists = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (fileNotExists && isDebugging()) {
      return {
        branch: 'debugging',
        commit: '123456',
        tag: 'v0.0.1',
      };
    }
    throw error;
  }
}

export const SERVER_VERSION = getServerVersion();
