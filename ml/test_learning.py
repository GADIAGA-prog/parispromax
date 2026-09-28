import unittest
import pandas as pd
from data_export import _finalize
from train_ltr import _grouped_time_split, ndcg_at_three


def field(course='race', winners='[1,2,3]', **extra):
    return [dict(course_id=course, race_date='2026-09-27', number=n,
                 distance_raw='2400m', musique={}, winners=winners, **extra)
            for n in range(1, 7)]


class LearningDataTests(unittest.TestCase):
    def test_metric_is_numeric_and_ties_do_not_depend_on_runner_order(self):
        self.assertEqual(ndcg_at_three([3, 2, 1, 0], [4, 3, 2, 1]), 1.0)
        self.assertLess(ndcg_at_three([3, 2, 1, 0], [1, 2, 3, 4]), 1.0)
        self.assertAlmostEqual(ndcg_at_three([3, 2, 1, 0], [1, 1, 1, 1]), ndcg_at_three([0, 1, 2, 3], [1, 1, 1, 1]))

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

    def test_removed_raw_runner_is_not_a_negative_example(self):
        frame = _finalize(pd.DataFrame(field(race_raw='{"horses":[{"number":1},{"number":2},{"number":3},{"number":4},{"number":5}]}')))
        self.assertEqual(set(frame.number), {1, 2, 3, 4, 5})

    def test_validation_uses_later_days_not_same_day(self):
        train, valid = _grouped_time_split(['a', 'b', 'c', 'd', 'e'], race_dates=['2026-09-26']*2 + ['2026-09-27']*3)
        self.assertEqual(train, {'a', 'b'})
        self.assertEqual(valid, {'c', 'd', 'e'})


if __name__ == '__main__':
    unittest.main()
