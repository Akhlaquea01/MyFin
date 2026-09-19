import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { useSession } from '../context/SessionContext';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import {
	computeVarianceReport,
	type CategoryVariance,
	type VarianceStatus
} from '../domain/budgets/budgetVarianceEngine';
import type { Category } from '../domain/entities';
import { formatMinorUnits } from '../domain/shared/money';

const STATUS_LABELS: Record<VarianceStatus, string> = {
	unbudgeted: 'Unbudgeted',
	under: 'Under',
	'on-track': 'On track',
	over: 'Over'
};

const STATUS_VARIANTS: Record<VarianceStatus, 'default' | 'secondary' | 'destructive'> = {
	unbudgeted: 'secondary',
	under: 'secondary',
	'on-track': 'default',
	over: 'destructive'
};

function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

function monthsBetweenInclusive(from: string, to: string): string[] {
	const [fy, fm] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	const months: string[] = [];
	let y = fy;
	let m = fm;
	let guard = 0;
	while ((y < ty || (y === ty && m <= tm)) && guard < 60) {
		months.push(`${y}-${String(m).padStart(2, '0')}`);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
		guard++;
	}
	return months;
}

// User Story 3 (P2, spec 019): a dedicated budgeted-vs-actual report across a month range,
// distinct from the general Analytics page. See contracts/budget-variance-report.md.
export function BudgetVarianceReportPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [categories, setCategories] = useState<Category[]>([]);
	const [rows, setRows] = useState<CategoryVariance[]>([]);
	const [fromMonth, setFromMonth] = useState(currentMonth());
	const [toMonth, setToMonth] = useState(currentMonth());
	const [loading, setLoading] = useState(true);

	const categoryNameById = useMemo(
		() => new Map(categories.map((c) => [c.id, c.name])),
		[categories]
	);

	async function refresh() {
		setLoading(true);
		const [cats, results] = await Promise.all([
			CategoryRepository.list(key),
			computeVarianceReport(key, monthsBetweenInclusive(fromMonth, toMonth))
		]);
		setCategories(cats);
		setRows(results);
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fromMonth, toMonth]);

	const sortedRows = [...rows].sort((a, b) => {
		const nameA = categoryNameById.get(a.categoryId) ?? '';
		const nameB = categoryNameById.get(b.categoryId) ?? '';
		return nameA.localeCompare(nameB) || a.month.localeCompare(b.month);
	});

	return (
		<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center gap-2">
				<BarChart3 className="size-6 text-primary" />
				<h1 className="text-2xl font-semibold tracking-tight">Budget vs. Actual</h1>
			</div>

			<div className="mb-4 grid grid-cols-2 gap-3 sm:w-80">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="variance-from">From</Label>
					<Input
						id="variance-from"
						type="month"
						value={fromMonth}
						onChange={(e) => setFromMonth(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="variance-to">To</Label>
					<Input
						id="variance-to"
						type="month"
						value={toMonth}
						onChange={(e) => setToMonth(e.target.value)}
					/>
				</div>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : sortedRows.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="py-10 text-center text-sm text-muted-foreground">
						No budgets or spend found for this period.
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="pt-6">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Category</TableHead>
									<TableHead>Month</TableHead>
									<TableHead className="text-right">Budgeted</TableHead>
									<TableHead className="text-right">Actual</TableHead>
									<TableHead className="text-right">Variance</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{sortedRows.map((row) => (
									<TableRow key={`${row.categoryId}-${row.month}`}>
										<TableCell>{categoryNameById.get(row.categoryId) ?? 'Unknown'}</TableCell>
										<TableCell>{row.month}</TableCell>
										<TableCell className="text-right font-mono">
											{row.budgetedMinor === null ? '—' : formatMinorUnits(row.budgetedMinor)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatMinorUnits(row.actualMinor)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{row.varianceMinor === null ? '—' : formatMinorUnits(row.varianceMinor)}
										</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANTS[row.status]}>
												{STATUS_LABELS[row.status]}
											</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
