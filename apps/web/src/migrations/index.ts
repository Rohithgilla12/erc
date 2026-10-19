import * as migration_20261019_113052_initial from './20261019_113052_initial';
import * as migration_20261019_114743_race_source_confirmed_by from './20261019_114743_race_source_confirmed_by';

export const migrations = [
  {
    up: migration_20261019_113052_initial.up,
    down: migration_20261019_113052_initial.down,
    name: '20261019_113052_initial',
  },
  {
    up: migration_20261019_114743_race_source_confirmed_by.up,
    down: migration_20261019_114743_race_source_confirmed_by.down,
    name: '20261019_114743_race_source_confirmed_by'
  },
];
