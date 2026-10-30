//! Sparse LDLᵀ for the FEM system. Nested separators limit fill, with reverse
//! breadth-first ordering as a fallback. Numeric row elimination uses a dense work vector
//! instead of allocating tree entries for every Schur-complement update.
//! Failure falls back to CG on the original equations, without regularization.
use std::collections::VecDeque;

type FactorColumn = (usize, f64, Vec<(usize, f64)>);

/// Sparse IC(0) preconditioning for charts exceeding the direct factor's fill
/// budget. This is a numerical working layer only: every original unknown,
/// triangle and boundary spring remains in A*x=b. It never adds sewing cuts.
/// Positive pivot safeguards affect the preconditioner, not the equations.
pub(crate) fn solve_iterative(matrix: &[Vec<(usize, f64)>], rhs: &[f64]) -> Option<Vec<f64>> {
    let n = matrix.len();
    if n == 0 || rhs.len() != n { return None; }
    let diagonal: Vec<f64> = matrix.iter().enumerate().map(|(i, row)|
        row.iter().find(|&&(j, _)| j == i).map(|&(_, a)| a).unwrap_or(0.)).collect();
    if diagonal.iter().any(|d| !d.is_finite() || *d <= 0.) { return None; }
    let scale: Vec<_> = diagonal.iter().map(|a| a.sqrt()).collect();
    let mut lower: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    let mut pivots = vec![1.; n];
    for i in 0..n {
        for &(j, a) in &matrix[i] {
            if j >= n || !a.is_finite() { return None; }
            if j >= i { continue; }
            let mut value = a / scale[i] / scale[j];
            let (mut p, mut q) = (0, 0);
            while p < lower[i].len() && q < lower[j].len() {
                let (k, l) = lower[i][p]; let (h, r) = lower[j][q];
                if k == h { value -= l * pivots[k] * r; p += 1; q += 1; }
                else if k < h { p += 1; } else { q += 1; }
            }
            let l = value / pivots[j];
            if !l.is_finite() { return None; }
            lower[i].push((j, l));
        }
        let d = 1. - lower[i].iter().map(|&(j, l)| l*l*pivots[j]).sum::<f64>();
        // Incomplete fill can destroy positive definiteness even when A is
        // SPD. A bounded positive IC pivot retains an SPD preconditioner.
        pivots[i] = if d > 0.01 { d } else { 1. };
    }
    let precondition = |r: &[f64]| {
        let mut z: Vec<_> = r.iter().zip(&scale).map(|(r,s)| r/s).collect();
        for i in 0..n { z[i] -= lower[i].iter().map(|&(j,l)| l*z[j]).sum::<f64>(); }
        for i in 0..n { z[i] /= pivots[i]; }
        for i in (0..n).rev() { let v=z[i]; for &(j,l) in &lower[i] { z[j] -= l*v; } }
        for i in 0..n { z[i] /= scale[i]; } z
    };
    let multiply = |x: &[f64]| matrix.iter().map(|row| row.iter().map(|&(j,a)| a*x[j]).sum::<f64>()).collect::<Vec<_>>();
    let inner = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(a,b)| a*b).sum::<f64>();
    let tolerance=1e-10*inner(rhs,rhs).sqrt().max(1.);
    let mut x=vec![0.;n]; let mut r=rhs.to_vec(); let mut z=precondition(&r);
    let mut p=z.clone(); let mut rz=inner(&r,&z);
    for _ in 0..2000 {
        if inner(&r,&r).sqrt()<=tolerance {
            let exact:Vec<_>=rhs.iter().zip(multiply(&x)).map(|(b,a)| b-a).collect();
            if inner(&exact,&exact).sqrt()<=tolerance { return Some(x); }
            r=exact;z=precondition(&r);p=z.clone();rz=inner(&r,&z);
        }
        let ap=multiply(&p);let denominator=inner(&p,&ap);
        if !denominator.is_finite() || denominator<=0. || !rz.is_finite() { return None; }
        let alpha=rz/denominator;
        for i in 0..n { x[i]+=alpha*p[i];r[i]-=alpha*ap[i]; }
        z=precondition(&r);let next=inner(&r,&z);let beta=next/rz;
        for i in 0..n { p[i]=z[i]+beta*p[i]; }rz=next;
    }
    let residual:Vec<_>=rhs.iter().zip(multiply(&x)).map(|(b,a)| b-a).collect();
    (inner(&residual,&residual).sqrt()<=tolerance).then_some(x)
}
pub(crate) struct Factor {
    columns: Vec<FactorColumn>,
    scale: Option<Vec<f64>>,
}
/// Fixed symbolic fill for a sequence of matrices whose coefficients change,
/// but whose structural entries do not. Numeric LDL factors and the original
/// equations are recomputed each time; only allocation and reach analysis are
/// reused. Structural zeros are included because later iterations can fill them.
pub(crate) struct ReusableFactor {
    order: Vec<usize>,
    position: Vec<usize>,
    rows: Vec<Vec<(usize, usize)>>,
    columns: Vec<Vec<(usize, f64)>>,
    diagonal: Vec<f64>,
    workspace: Vec<f64>,
}
impl ReusableFactor {
    pub(crate) fn new(matrix: &[Vec<(usize, f64)>], order: &[usize]) -> Option<Self> {
        let n = matrix.len();
        if n > 50_000 || order.len() != n { return None; }
        let mut position = vec![usize::MAX; n];
        for (k, &i) in order.iter().enumerate() {
            if i >= n || position[i] != usize::MAX { return None; }
            position[i] = k;
        }
        let mut parent = vec![usize::MAX; n];
        let mut mark = vec![usize::MAX; n];
        let mut columns = vec![Vec::new(); n];
        let mut rows = vec![Vec::new(); n];
        let mut work = 0usize;
        let mut fill = 0usize;
        for (k, &original) in order.iter().enumerate() {
            mark[k] = k;
            let mut reach = Vec::new();
            for &(j, a) in &matrix[original] {
                if j >= n || !a.is_finite() { return None; }
                let mut j = position[j];
                if j >= k { continue; }
                while mark[j] != k {
                    reach.push(j);
                    mark[j] = k;
                    if parent[j] == usize::MAX { parent[j] = k; }
                    j = parent[j];
                }
            }
            reach.sort_unstable();
            for j in reach {
                let slot = columns[j].len();
                work = work.checked_add(slot)?;
                fill += 1;
                if work > 40_000_000 || fill > 1_000_000 { return None; }
                rows[k].push((j, slot));
                columns[j].push((k, 0.));
            }
        }
        Some(Self { order: order.to_vec(), position, rows, columns,
            diagonal: vec![0.; n], workspace: vec![0.; n] })
    }
    pub(crate) fn factor(&mut self, matrix: &[Vec<(usize, f64)>]) -> bool {
        if matrix.len() != self.order.len() { return false; }
        self.workspace.fill(0.);
        for (k, &original) in self.order.iter().enumerate() {
            for &(j, a) in &matrix[original] {
                if j >= self.position.len() || !a.is_finite() { return false; }
                let j = self.position[j];
                if j < k && self.rows[k].binary_search_by_key(&j, |&(i, _)| i).is_err() { return false; }
                if j <= k { self.workspace[j] += a; }
            }
            let mut d = self.workspace[k];
            self.workspace[k] = 0.;
            for &(j, slot) in &self.rows[k] {
                let value = self.workspace[j];
                self.workspace[j] = 0.;
                for &(i, l) in &self.columns[j][..slot] { self.workspace[i] -= value * l; }
                let l = value / self.diagonal[j];
                if !l.is_finite() { return false; }
                d -= value * l;
                self.columns[j][slot].1 = l;
            }
            if !d.is_finite() || d <= 0. { return false; }
            self.diagonal[k] = d;
        }
        true
    }
    pub(crate) fn solve(&self, rhs: &[f64]) -> Vec<f64> {
        let mut x: Vec<_> = self.order.iter().map(|&i| rhs[i]).collect();
        for (k, column) in self.columns.iter().enumerate() {
            let y = x[k];
            for &(i, l) in column { x[i] -= l * y; }
        }
        for (x, d) in x.iter_mut().zip(&self.diagonal) { *x /= d; }
        for (k, column) in self.columns.iter().enumerate().rev() {
            x[k] -= column.iter().map(|&(i, l)| l * x[i]).sum::<f64>();
        }
        let mut result = vec![0.; x.len()];
        for (k, &i) in self.order.iter().enumerate() { result[i] = x[k]; }
        result
    }
}
impl Factor {
    pub(crate) fn new(matrix: &[Vec<(usize, f64)>]) -> Option<Self> {
        // Symmetric equilibration keeps the physical equations unchanged while
        // avoiding tiny pivots caused only by disparate local triangle scales.
        // Callers still check residuals against the original matrix.
        let scale: Option<Vec<f64>> = matrix.iter().enumerate().map(|(i, row)| {
            row.iter().find(|&&(j, _)| j == i).and_then(|&(_, a)| {
                if a > 0. && a.is_finite() { Some(a.sqrt()) } else { None }
            })
        }).collect();
        if let Some(scale) = scale {
            if matrix.len() <= 50_000 && matrix.iter().flatten().all(|&(j, a)| j < scale.len() && a.is_finite()) {
                let normalized: Vec<Vec<(usize, f64)>> = matrix.iter().enumerate().map(|(i, row)| {
                    row.iter().map(|&(j, a)| (j, a / scale[i] / scale[j])).collect()
                }).collect();
                if let Some(mut factor) = Self::unscaled(&normalized) {
                    factor.scale = Some(scale);
                    return Some(factor);
                }
            }
        }
        Self::unscaled(matrix)
    }
    fn unscaled(matrix: &[Vec<(usize, f64)>]) -> Option<Self> {
        if matrix.len() >= 128 {
            if let Some(order) = nested_order(matrix) {
                if let Some(factor) = Self::ordered(matrix, &order) {
                    return Some(factor);
                }
            }
        }
        Self::reverse_breadth_first(matrix)
    }
    pub(crate) fn reverse_breadth_first(matrix: &[Vec<(usize, f64)>]) -> Option<Self> {
        let n = matrix.len();
        if n > 50_000
            || matrix
                .iter()
                .flatten()
                .any(|&(j, a)| j >= n || !a.is_finite())
        {
            return None;
        }
        let degree: Vec<_> = matrix
            .iter()
            .enumerate()
            .map(|(i, row)| row.iter().filter(|&&(j, a)| j != i && a != 0.).count())
            .collect();
        let mut seeds: Vec<_> = (0..n).collect();
        seeds.sort_unstable_by_key(|&i| (degree[i], i));
        let mut seen = vec![false; n];
        let mut order = Vec::with_capacity(n);
        for seed in seeds {
            if seen[seed] {
                continue;
            }
            let mut queue = VecDeque::from([seed]);
            seen[seed] = true;
            while let Some(i) = queue.pop_front() {
                order.push(i);
                let mut neighbors: Vec<_> = matrix[i]
                    .iter()
                    .filter(|&&(j, a)| j != i && a != 0. && !seen[j])
                    .map(|&(j, _)| j)
                    .collect();
                neighbors.sort_unstable_by_key(|&j| (degree[j], j));
                for j in neighbors {
                    if !seen[j] {
                        seen[j] = true;
                        queue.push_back(j);
                    }
                }
            }
        }
        order.reverse();
        Self::ordered(matrix, &order)
    }
    /// Reuse a symbolic ordering for matrices with the same structural edges.
    /// Values are still refactored exactly; no diagonal regularization or
    /// approximate inverse is introduced into the physical equations.
    pub(crate) fn ordered(matrix: &[Vec<(usize, f64)>], order: &[usize]) -> Option<Self> {
        let n = matrix.len();
        if n > 50_000
            || order.len() != n
            || matrix
                .iter()
                .flatten()
                .any(|&(j, a)| j >= n || !a.is_finite())
        {
            return None;
        }
        let mut position = vec![usize::MAX; n];
        for (k, &i) in order.iter().enumerate() {
            if i >= n || position[i] != usize::MAX {
                return None;
            }
            position[i] = k;
        }
        let mut columns: Vec<Vec<(usize, f64)>> = vec![vec![]; n];
        let mut diagonal = vec![0.; n];
        let mut workspace = vec![0.; n];

        let mut work = 0usize;
        let mut fill = 0usize;
        for (k, &original) in order.iter().enumerate() {
            let mut first = k;
            for &(j, a) in &matrix[original] {
                let j = position[j];
                if j <= k && a != 0. {
                    workspace[j] += a;
                    first = first.min(j);
                }
            }
            let mut d = workspace[k];
            workspace[k] = 0.;
            // L D times row k of L equals column k of A. Contributions can
            // only reach later indices, so each workspace entry is final
            // when consumed. Previously stored columns contain rows < k.
            for j in first..k {
                let value = workspace[j];
                workspace[j] = 0.;
                if value == 0. {
                    continue;
                }
                work = work.checked_add(columns[j].len())?;
                fill += 1;
                if work > 40_000_000 || fill > 1_000_000 {
                    return None;
                }
                for &(i, l) in &columns[j] {
                    workspace[i] -= value * l;

                }
                let l = value / diagonal[j];
                if !l.is_finite() {
                    return None;
                }
                d -= value * l;
                columns[j].push((k, l));
            }
            if !d.is_finite() || d <= 0. {
                return None;
            }
            diagonal[k] = d;
        }
        Some(Self {
            scale: None,
            columns: columns
                .into_iter()
                .enumerate()
                .map(|(k, rows)| {
                    (
                        order[k],
                        diagonal[k],
                        rows.into_iter().map(|(i, a)| (order[i], a)).collect(),
                    )
                })
                .collect(),
        })
    }
    pub(crate) fn solve(&self, rhs: &[f64]) -> Vec<f64> {
        let mut out = self.scale.as_ref().map_or_else(||rhs.to_vec(), |scale| rhs.iter().zip(scale).map(|(b,d)| b/d).collect::<Vec<_>>());
        for &(pivot, _, ref column) in &self.columns {
            let y = out[pivot];
            for &(i, l) in column {
                out[i] -= l * y;
            }
        }
        for &(pivot, d, _) in &self.columns {
            out[pivot] /= d;
        }
        for &(pivot, _, ref column) in self.columns.iter().rev() {
            out[pivot] -= column.iter().map(|&(i, l)| l * out[i]).sum::<f64>();
        }
        if let Some(scale) = &self.scale { for (x,d) in out.iter_mut().zip(scale) { *x /= d; } }
        out
    }
}

/// Eliminate sparse interiors before separators. A balanced breadth-first
/// layer separates the two induced subgraphs without assuming a mesh's vertex
/// order or moving any physical station. Analyze once for a sequence of
/// boundary-length linearizations whose numeric coefficients change.
pub(crate) fn nested_order(matrix: &[Vec<(usize, f64)>]) -> Option<Vec<usize>> {
    let n = matrix.len();
    if n > 50_000
        || matrix
            .iter()
            .flatten()
            .any(|&(j, a)| j >= n || !a.is_finite())
    {
        return None;
    }
    let mut graph = vec![Vec::new(); n];
    for (i, row) in matrix.iter().enumerate() {
        for &(j, _) in row {
            if i != j {
                graph[i].push(j);
                graph[j].push(i);
            }
        }
    }
    for row in &mut graph {
        row.sort_unstable();
        row.dedup();
    }
    fn visit(nodes: Vec<usize>, graph: &[Vec<usize>], out: &mut Vec<usize>) {
        if nodes.len() <= 32 {
            out.extend(nodes);
            return;
        }
        let mut member = vec![false; graph.len()];
        for &i in &nodes {
            member[i] = true;
        }
        let distances = |seed: usize| {
            let mut d = vec![usize::MAX; graph.len()];
            let mut q = VecDeque::from([seed]);
            d[seed] = 0;
            while let Some(i) = q.pop_front() {
                for &j in &graph[i] {
                    if member[j] && d[j] == usize::MAX {
                        d[j] = d[i] + 1;
                        q.push_back(j);
                    }
                }
            }
            d
        };
        let seed = *nodes
            .iter()
            .min_by_key(|&&i| (graph[i].iter().filter(|&&j| member[j]).count(), i))
            .unwrap();
        let first = distances(seed);
        let far = *nodes
            .iter()
            .filter(|&&i| first[i] != usize::MAX)
            .max_by_key(|&&i| (first[i], std::cmp::Reverse(i)))
            .unwrap();
        let d = distances(far);
        let disconnected: Vec<_> = nodes
            .iter()
            .copied()
            .filter(|&i| d[i] == usize::MAX)
            .collect();
        if !disconnected.is_empty() {
            let component = nodes.into_iter().filter(|&i| d[i] != usize::MAX).collect();
            visit(component, graph, out);
            visit(disconnected, graph, out);
            return;
        }
        let last = nodes.iter().map(|&i| d[i]).max().unwrap();
        if last < 2 {
            out.extend(nodes);
            return;
        }
        let mut levels = vec![0usize; last + 1];
        for &i in &nodes {
            levels[d[i]] += 1;
        }
        let mut left = 0usize;
        let mut chosen = None;
        for (level, &width) in levels.iter().enumerate() {
            let right = nodes.len() - left - width;
            if left > 0 && right > 0 && left.max(right) * 4 <= nodes.len() * 3 {
                let score = (width, left.abs_diff(right), level);
                if chosen.is_none_or(|old| score < old) {
                    chosen = Some(score);
                }
            }
            left += width;
        }
        let Some((_, _, level)) = chosen else {
            out.extend(nodes);
            return;
        };
        let before = nodes.iter().copied().filter(|&i| d[i] < level).collect();
        let after = nodes.iter().copied().filter(|&i| d[i] > level).collect();
        let separator = nodes.into_iter().filter(|&i| d[i] == level).collect();
        visit(before, graph, out);
        visit(after, graph, out);
        visit(separator, graph, out);
    }
    let mut order = Vec::with_capacity(n);
    visit((0..n).collect(), &graph, &mut order);
    Some(order)
}

#[cfg(test)]
mod tests {
    use super::Factor;

    fn assert_known_solution(matrix: &[Vec<(usize, f64)>], factor: &Factor, expected: &[f64]) {
        let rhs: Vec<f64> = matrix.iter()
            .map(|row| row.iter().map(|&(j, a)| a * expected[j]).sum())
            .collect();
        let actual = factor.solve(&rhs);
        let scale = expected.iter().map(|x| x.abs()).fold(1_f64, f64::max);
        for (i, (&a, &b)) in actual.iter().zip(expected).enumerate() {
            assert!((a - b).abs() < scale * 1e-10, "unknown {i}: {a} != {b}");
        }
        for (i, row) in matrix.iter().enumerate() {
            let residual = row.iter().map(|&(j, a)| a * actual[j]).sum::<f64>() - rhs[i];
            let magnitude = row.iter().map(|&(j, a)| (a * expected[j]).abs()).sum::<f64>().max(1.);
            assert!(residual.abs() < magnitude * 1e-11, "original row {i}: residual {residual}");
        }
    }

    fn graph_matrix(n: usize, edges: &[(usize, usize, f64)]) -> Vec<Vec<(usize, f64)>> {
        // I plus a weighted graph Laplacian is SPD independently of the
        // factorizer. Long empty stretches and generated fill are intentional.
        let mut matrix = vec![vec![]; n];
        let mut diagonal = vec![1.; n];
        for &(i, j, weight) in edges {
            matrix[i].push((j, -weight));
            matrix[j].push((i, -weight));
            diagonal[i] += weight;
            diagonal[j] += weight;
        }
        for i in 0..n { matrix[i].push((i, diagonal[i])); }
        matrix
    }

    #[test]
    fn sparse_queue_preserves_chain_solutions_and_reuse_under_distinct_orders() {
        let n = 257;
        let edges: Vec<_> = (1..n).filter(|i| i % 64 != 0)
            .map(|i| (i - 1, i, 0.5 + (i % 7) as f64 / 4.))
            .collect();
        let matrix = graph_matrix(n, &edges);
        let before = matrix.clone();
        let orders = [
            (0..n).collect::<Vec<_>>(),
            (0..n).rev().collect(),
            (0..n).step_by(2).chain((1..n).step_by(2)).collect(),
            (0..n).map(|i| i * 37 % n).collect(),
        ];
        for order in orders {
            let factor = Factor::ordered(&matrix, &order).expect("anchored sparse chains are SPD");
            for scale in [1e-6, 1., 1000.] {
                let expected: Vec<_> = (0..n).map(|i| {
                    scale * ((i as f64 * 0.17).sin() + (i % 5) as f64 / 8.)
                }).collect();
                assert_known_solution(&matrix, &factor, &expected);
            }
        }
        assert_eq!(matrix, before);
    }

    #[test]
    fn sparse_queue_reaches_fill_absent_from_the_original_row() {
        let n = 41;
        let edges: Vec<_> = (1..n).map(|i| (0, i, 1. + (i % 3) as f64 / 2.)).collect();
        let matrix = graph_matrix(n, &edges);
        let before = matrix.clone();
        // Eliminating the centre first connects all previously independent
        // leaves. Those queue entries must be discovered by elimination,
        // rather than only by reading the original sparse row.
        for order in [
            (0..n).collect::<Vec<_>>(),
            (0..n).rev().collect(),
            (0..n).map(|i| i * 13 % n).collect(),
        ] {
            let factor = Factor::ordered(&matrix, &order).expect("anchored star is SPD");
            for offset in [-7.25, 3.5] {
                let expected: Vec<_> = (0..n)
                    .map(|i| offset + (i % 4) as f64 * 0.125 - i as f64 / 32.)
                    .collect();
                assert_known_solution(&matrix, &factor, &expected);
            }
        }
        assert_eq!(matrix, before);
    }

    #[test]
    fn sparse_queue_keeps_a_cancelled_station_until_an_earlier_pivot_restores_it() {
        // A = L L^T with unit diagonal and rows of L:
        // (1), (1,1), (1,1,1), (1,1,-1,1). Thus A is SPD.
        // In original order, row 3's entry 2 starts at 1, becomes exactly 0
        // after pivot 0, then becomes -1 after pivot 1. A scheduled zero must
        // neither disappear permanently nor be processed twice on restoration.
        let matrix = vec![
            vec![(0, 1.), (1, 1.), (2, 1.), (3, 1.)],
            vec![(0, 1.), (1, 2.), (2, 2.), (3, 2.)],
            vec![(0, 1.), (1, 2.), (2, 3.), (3, 1.)],
            vec![(0, 1.), (1, 2.), (2, 1.), (3, 4.)],
        ];
        let expected = [0.125, -3.5, 2.25, 7.75];
        let rhs = [6.625, 13.125, 7.625, 26.375];
        let factor = Factor::ordered(&matrix, &[0, 1, 2, 3]).unwrap();
        for (actual, expected) in factor.solve(&rhs).iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-12);
        }
        for a in 0..4 { for b in 0..4 { for c in 0..4 { for d in 0..4 {
            if a == b || a == c || a == d || b == c || b == d || c == d { continue; }
            let factor = Factor::ordered(&matrix, &[a, b, c, d]).unwrap();
            assert_known_solution(&matrix, &factor, &expected);
        } } } }
    }

    #[test]
    fn sparse_queue_propagates_dynamic_fill_across_multiple_sixty_four_bit_blocks() {
        let n = 137;
        let edges: Vec<_> = (1..n).map(|i| (0, i, 0.5 + (i % 5) as f64 / 8.)).collect();
        let matrix = graph_matrix(n, &edges);
        for order in [
            (0..n).collect::<Vec<_>>(),
            (0..n).map(|i| i * 37 % n).collect(),
            (0..n).rev().collect(),
        ] {
            let factor = Factor::ordered(&matrix, &order).unwrap();
            let expected: Vec<_> = (0..n).map(|i| (i as f64 * 0.31).cos() - i as f64 / 128.).collect();
            assert_known_solution(&matrix, &factor, &expected);
        }
    }

    #[test]
    fn sparse_queue_restores_cancelled_fill_at_a_sixty_four_bit_block_boundary() {
        let n = 130;
        let indices = [0, 63, 64, 128];
        let block = [[1., 1., 1., 1.], [1., 2., 2., 2.], [1., 2., 3., 1.], [1., 2., 1., 4.]];
        let mut matrix: Vec<_> = (0..n).map(|i| vec![(i, 1.)]).collect();
        for (row, &i) in indices.iter().enumerate() {
            matrix[i] = indices.iter().enumerate().map(|(column, &j)| (j, block[row][column])).collect();
        }
        let mut expected: Vec<_> = (0..n).map(|i| i as f64 / 16. - 0.5).collect();
        for (&i, value) in indices.iter().zip([0.125, -3.5, 2.25, 7.75]) { expected[i] = value; }
        // In row 128, pivot 0 cancels position 64; pivot 63 restores it
        // before the scan advances into the next word. Empty intervening
        // identity rows must not leave stale bits or workspace values behind.
        for order in [
            (0..n).collect::<Vec<_>>(),
            (0..n).map(|i| i * 37 % n).collect(),
            (0..n).map(|i| (i + 65) % n).collect(),
        ] {
            let factor = Factor::ordered(&matrix, &order).unwrap();
            assert_known_solution(&matrix, &factor, &expected);
        }
    }

    #[test]
    fn sparse_queue_preserves_rejection_of_singular_and_indefinite_equations() {
        for matrix in [
            vec![vec![(0, 1.), (1, -1.)], vec![(0, -1.), (1, 1.)]],
            vec![vec![(0, 1.), (1, 2.)], vec![(0, 2.), (1, 1.)]],
            vec![vec![(0, 1.)], vec![]],
        ] {
            let before = matrix.clone();
            for order in [[0, 1], [1, 0]] {
                assert!(Factor::ordered(&matrix, &order).is_none());
            }
            assert!(Factor::new(&matrix).is_none());
            assert_eq!(matrix, before);
        }
    }

    #[test]
    fn reusable_factor_preserves_the_original_equations() {
        let rows = vec![
            vec![(0, 4.), (1, -1.), (3, -1.)],
            vec![(0, -1.), (1, 4.), (2, -1.)],
            vec![(1, -1.), (2, 4.), (3, -1.)],
            vec![(0, -1.), (2, -1.), (3, 4.)],
        ];
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
    fn fixed_symbolic_fill_preserves_changing_coefficients_and_recovers_after_failure() {
        let n = 63;
        let matrix = |phase: usize| {
            let mut rows = vec![vec![]; n];
            let mut diagonal = vec![1.; n];
            for i in 0..n {
                for j in [i + 1, i + 7].into_iter().filter(|&j| j < n) {
                    let weight = if (i + j + phase) % 3 == 0 { 0. } else { 1. + ((i * 7 + j * 13 + phase) % 19) as f64 };
                    rows[i].push((j, -weight)); rows[j].push((i, -weight));
                    diagonal[i] += weight; diagonal[j] += weight;
                }
            }
            for i in 0..n { rows[i].push((i, diagonal[i])); }
            rows
        };
        let initial = matrix(0);
        let order = super::nested_order(&initial).unwrap();
        let mut reusable = super::ReusableFactor::new(&initial, &order).unwrap();
        for phase in 0..9 {
            let rows = matrix(phase);
            assert!(reusable.factor(&rows));
            for scale in [1e-6, 1., 1000.] {
                let expected: Vec<_> = (0..n).map(|i| (i as f64 * 0.31).sin() * scale).collect();
                let rhs: Vec<_> = rows.iter().map(|r| r.iter().map(|&(j, a)| a * expected[j]).sum()).collect();
                let actual = reusable.solve(&rhs);
                let reference = Factor::ordered(&rows, &order).unwrap().solve(&rhs);
                for ((a, b), c) in actual.iter().zip(&expected).zip(&reference) {
                    assert!((a - b).abs() < scale * 1e-10);
                    assert!((a - c).abs() < scale * 1e-10);
                }
            }
            let invalid: Vec<_> = rows.iter().enumerate().map(|(i, row)| row.iter().map(|&(j, a)| (j, if i == j { -1. } else { a })).collect()).collect();
            assert!(!reusable.factor(&invalid));
        }
    }

    #[test]
    fn curved_chart_sized_system_preserves_scale_and_multiple_right_hand_sides() {
        let (width, height) = (29, 23);
        let n = width * height;
        let mut rows = vec![vec![]; n];
        let mut diagonal = vec![0.01; n];
        for i in 0..n {
            for j in [
                if i % width + 1 < width {
                    Some(i + 1)
                } else {
                    None
                },
                if i + width < n { Some(i + width) } else { None },
            ]
            .into_iter()
            .flatten()
            {
                let weight = 1. + ((i * 31 + j * 17) % 97) as f64;
                rows[i].push((j, -weight));
                rows[j].push((i, -weight));
                diagonal[i] += weight;
                diagonal[j] += weight;
            }
        }
        for i in 0..n {
            rows[i].push((i, diagonal[i]));
        }
        let factor = Factor::new(&rows).unwrap();
        for scale in [1e-6, 1., 1000.] {
            let expected: Vec<_> = (0..n).map(|i| (i as f64 * 0.17).sin() * scale).collect();
            let rhs: Vec<_> = rows
                .iter()
                .map(|r| r.iter().map(|&(j, a)| a * expected[j]).sum())
                .collect();
            let x = factor.solve(&rhs);
            for (a, b) in x.iter().zip(expected) {
                assert!((a - b).abs() < scale * 1e-8);
            }
        }
    }
}
/// Rank-revealing Householder QR for small, ill-conditioned cloth charts.
/// Solve the original conformal equations, without squaring the condition
/// number in A'A. All source triangles and their physical weights remain.
pub fn solve_least_squares(rows: &[(Vec<(usize, f64)>, f64)], n: usize) -> Option<Vec<f64>> {
    let m = rows.len();
    if n == 0 || n > 256 || m < n || m > 2048 { return None; }
    let mut a = vec![vec![0.; n]; m];
    let mut b: Vec<_> = rows.iter().map(|r| r.1).collect();
    for (i, (row, _)) in rows.iter().enumerate() {
        for &(j, value) in row { a[i][j] += value; }
    }
    let scale: Vec<f64> = (0..n).map(|j| a.iter().map(|r| r[j]*r[j]).sum::<f64>().sqrt()).collect();
    if scale.iter().any(|s| !s.is_finite() || *s <= 0.) { return None; }
    for row in &mut a { for j in 0..n { row[j] /= scale[j]; } }
    let mut order: Vec<_> = (0..n).collect();
    for k in 0..n {
        let pivot = (k..n).max_by(|&j,&l| {
            let norm = |j:usize| a[k..].iter().map(|r| r[j]*r[j]).sum::<f64>();
            norm(j).total_cmp(&norm(l))
        })?;
        for row in &mut a { row.swap(k,pivot); } order.swap(k,pivot);
        let norm = a[k..].iter().map(|r| r[k]*r[k]).sum::<f64>().sqrt();
        if norm < 1e-14 || !norm.is_finite() { return None; }
        let alpha = -norm.copysign(a[k][k]);
        let mut v: Vec<_> = a[k..].iter().map(|r| r[k]).collect(); v[0] -= alpha;
        let beta = 2. / v.iter().map(|x| x*x).sum::<f64>();
        for j in k+1..n {
            let dot = beta * v.iter().enumerate().map(|(i,x)| x*a[k+i][j]).sum::<f64>();
            for (i,x) in v.iter().enumerate() { a[k+i][j] -= dot*x; }
        }
        let dot = beta * v.iter().enumerate().map(|(i,x)| x*b[k+i]).sum::<f64>();
        for (i,x) in v.iter().enumerate() { b[k+i] -= dot*x; }
        a[k][k] = alpha; for row in &mut a[k+1..] { row[k] = 0.; }
    }
    let mut x = vec![0.; n];
    for i in (0..n).rev() { x[i] = (b[i]-(i+1..n).map(|j|a[i][j]*x[j]).sum::<f64>())/a[i][i]; }
    let mut result = vec![0.;n]; for i in 0..n { result[order[i]]=x[i]/scale[order[i]]; }
    result.iter().all(|v|v.is_finite()).then_some(result)
}
