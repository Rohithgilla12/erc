import * as migration_20261019_113052_initial from './20261019_113052_initial';

export const migrations = [
  {
    up: migration_20261019_113052_initial.up,
    down: migration_20261019_113052_initial.down,
    name: '20261019_113052_initial'
  },
];
