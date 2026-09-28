import unittest
import pandas as pd
from data_export import _finalize
from train_ltr import _grouped_time_split


def field(course='race', winners='[1,2,3]', **extra):
    return [dict(course_id=course, race_date='2026-09-27', number=n,
                 distance_raw='2400m', musique={}, winners=winners, **extra)
            for n in range(1, 7)]


class LearningDataTests(unittest.TestCase):
    def test_partial_arrivals_are_not_losing_training_labels(self):
        frame = _finalize(pd.DataFrame(field('partial', '[1,2]') + field('complete')))
        self.assertEqual(set(frame.course_id), {'complete'})
        self.assertEqual(frame.finish_pos.dropna().tolist(), [1, 2, 3])

    def test_non_runners_and_invalid_podium_are_excluded(self):
        frame = _finalize(pd.DataFrame(field(non_partants='[6]')))
        self.assertNotIn(6, set(frame.number))
        self.assertTrue(_finalize(pd.DataFrame(field(non_partants='[2]'))).empty)
        self.assertTrue(_finalize(pd.DataFrame(field(winners='[1,1,3]'))).empty)

    def test_retrospective_features_exclude_whole_race(self):
        rows = field(race_raw='{"time":"14:30"}', features_created_at='2026-09-27T10:00:00Z')
        self.assertEqual(len(_finalize(pd.DataFrame(rows))), 6)
        rows[-1]['features_created_at'] = '2026-09-27T15:00:00Z'
        self.assertTrue(_finalize(pd.DataFrame(rows)).empty)

    def test_validation_uses_later_days_not_same_day(self):
        train, valid = _grouped_time_split(['a', 'b', 'c', 'd', 'e'], race_dates=['2026-09-26']*2 + ['2026-09-27']*3)
        self.assertEqual(train, {'a', 'b'})
        self.assertEqual(valid, {'c', 'd', 'e'})


if __name__ == '__main__':
    unittest.main()
