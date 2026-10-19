import * as migration_20261019_113052_initial from './20261019_113052_initial';
import * as migration_20261019_114743_race_source_confirmed_by from './20261019_114743_race_source_confirmed_by';
import * as migration_20261019_122421_editorial_live_and_revision from './20261019_122421_editorial_live_and_revision';
import * as migration_20261019_123018_race_moderation_submitter from './20261019_123018_race_moderation_submitter';
import * as migration_20261019_153553_athletes_results from './20261019_153553_athletes_results';
import * as migration_20261019_153928_learning_centre from './20261019_153928_learning_centre';
import * as migration_20261019_154509_pages_and_enquiries from './20261019_154509_pages_and_enquiries';

export const migrations = [
  {
    up: migration_20261019_113052_initial.up,
    down: migration_20261019_113052_initial.down,
    name: '20261019_113052_initial',
  },
  {
    up: migration_20261019_114743_race_source_confirmed_by.up,
    down: migration_20261019_114743_race_source_confirmed_by.down,
    name: '20261019_114743_race_source_confirmed_by',
  },
  {
    up: migration_20261019_122421_editorial_live_and_revision.up,
    down: migration_20261019_122421_editorial_live_and_revision.down,
    name: '20261019_122421_editorial_live_and_revision',
  },
  {
    up: migration_20261019_123018_race_moderation_submitter.up,
    down: migration_20261019_123018_race_moderation_submitter.down,
    name: '20261019_123018_race_moderation_submitter',
  },
  {
    up: migration_20261019_153553_athletes_results.up,
    down: migration_20261019_153553_athletes_results.down,
    name: '20261019_153553_athletes_results',
  },
  {
    up: migration_20261019_153928_learning_centre.up,
    down: migration_20261019_153928_learning_centre.down,
    name: '20261019_153928_learning_centre',
  },
  {
    up: migration_20261019_154509_pages_and_enquiries.up,
    down: migration_20261019_154509_pages_and_enquiries.down,
    name: '20261019_154509_pages_and_enquiries'
  },
];
