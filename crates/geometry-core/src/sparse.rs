//! Sparse LDLᵀ for the constant FEM system. Reverse breadth-first ordering
//! limits the bandwidth; numeric row elimination uses a dense work vector
//! instead of allocating tree entries for every Schur-complement update.
//! Failure falls back to CG on the original equations, without regularization.
use std::collections::VecDeque;

pub(crate) struct Factor {
    columns: Vec<(usize, f64, Vec<(usize, f64)>)>,
}
impl Factor {
    pub(crate) fn new(matrix: &[Vec<(usize, f64)>]) -> Option<Self> {
        let n = matrix.len();
        if n > 20_000 || matrix.iter().flatten().any(|&(j, a)| j >= n || !a.is_finite()) { return None; }
        let degree: Vec<_> = matrix.iter().enumerate().map(|(i, row)| row.iter().filter(|&&(j, a)| j != i && a != 0.).count()).collect();
        let mut seeds: Vec<_> = (0..n).collect();
        seeds.sort_unstable_by_key(|&i| (degree[i], i));
        let mut seen = vec![false; n];
        let mut order = Vec::with_capacity(n);
        for seed in seeds {
            if seen[seed] { continue; }
            let mut queue = VecDeque::from([seed]);
            seen[seed] = true;
            while let Some(i) = queue.pop_front() {
                order.push(i);
                let mut neighbors: Vec<_> = matrix[i].iter().filter(|&&(j, a)| j != i && a != 0. && !seen[j]).map(|&(j, _)| j).collect();
                neighbors.sort_unstable_by_key(|&j| (degree[j], j));
                for j in neighbors { if !seen[j] { seen[j] = true; queue.push_back(j); } }
            }
        }
        order.reverse();
        let mut position = vec![0; n];
        for (k, &i) in order.iter().enumerate() { position[i] = k; }
        let mut columns: Vec<Vec<(usize, f64)>> = vec![vec![]; n];
        let mut diagonal = vec![0.; n];
        let mut workspace = vec![0.; n];
        let mut work = 0usize;
        let mut fill = 0usize;
        for (k, &original) in order.iter().enumerate() {
            let mut first = k;
            for &(j, a) in &matrix[original] {
                let j = position[j];
                if j <= k && a != 0. { workspace[j] += a; first = first.min(j); }
            }
            let mut d = workspace[k];
            workspace[k] = 0.;
            // L D times row k of L equals column k of A. Contributions can
            // only reach later indices, so each workspace entry is final
            // when consumed. Previously stored columns contain rows < k.
            for j in first..k {
                let value = workspace[j];
                workspace[j] = 0.;
                if value == 0. { continue; }
                work = work.checked_add(columns[j].len())?;
                fill += 1;
                if work > 40_000_000 || fill > 1_000_000 { return None; }
                for &(i, l) in &columns[j] { workspace[i] -= value * l; }
                let l = value / diagonal[j];
                if !l.is_finite() { return None; }
                d -= value * l;
                columns[j].push((k, l));
            }
            if !d.is_finite() || d <= 0. { return None; }
            diagonal[k] = d;
        }
        Some(Self { columns: columns.into_iter().enumerate().map(|(k, rows)| (order[k], diagonal[k], rows.into_iter().map(|(i, a)| (order[i], a)).collect())).collect() })
    }
    pub(crate) fn solve(&self, rhs: &[f64]) -> Vec<f64> {
        let mut out = rhs.to_vec();
        for &(pivot, _, ref column) in &self.columns {
            let y = out[pivot];
            for &(i, l) in column { out[i] -= l * y; }
        }
        for &(pivot, d, _) in &self.columns { out[pivot] /= d; }
        for &(pivot, _, ref column) in self.columns.iter().rev() {
            out[pivot] -= column.iter().map(|&(i, l)| l * out[i]).sum::<f64>();
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::Factor;
    #[test]
    fn reusable_factor_preserves_the_original_equations() {
        let rows = vec![vec![(0, 4.), (1, -1.), (3, -1.)], vec![(0, -1.), (1, 4.), (2, -1.)], vec![(1, -1.), (2, 4.), (3, -1.)], vec![(0, -1.), (2, -1.), (3, 4.)]];
        let factor = Factor::new(&rows).unwrap();
        for rhs in [[1., 2., 3., 4.], [-4., 3., -2., 1.]] {
            let x = factor.solve(&rhs);
            for (i, row) in rows.iter().enumerate() {
                assert!((row.iter().map(|&(j, a)| a * x[j]).sum::<f64>() - rhs[i]).abs() < 1e-12);
            }
        }
        assert!(Factor::new(&[vec![(0, -1.)]]).is_none());
    }

    #[test]
    fn curved_chart_sized_system_preserves_scale_and_multiple_right_hand_sides() {
        let (width, height) = (29, 23);
        let n = width * height;
        let mut rows = vec![vec![]; n];
        let mut diagonal = vec![0.01; n];
        for i in 0..n {
            for j in [if i % width + 1 < width { Some(i + 1) } else { None }, if i + width < n { Some(i + width) } else { None }].into_iter().flatten() {
                let weight = 1. + ((i * 31 + j * 17) % 97) as f64;
                rows[i].push((j, -weight)); rows[j].push((i, -weight));
                diagonal[i] += weight; diagonal[j] += weight;
            }
        }
        for i in 0..n { rows[i].push((i, diagonal[i])); }
        let factor = Factor::new(&rows).unwrap();
        for scale in [1e-6, 1., 1000.] {
            let expected: Vec<_> = (0..n).map(|i| (i as f64 * 0.17).sin() * scale).collect();
            let rhs: Vec<_> = rows.iter().map(|r| r.iter().map(|&(j, a)| a * expected[j]).sum()).collect();
            let x = factor.solve(&rhs);
            for (a, b) in x.iter().zip(expected) { assert!((a - b).abs() < scale * 1e-8); }
        }
    }
}
