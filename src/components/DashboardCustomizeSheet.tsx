import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
	SheetFooter,
	SheetTrigger
} from './ui/sheet';
import { DASHBOARD_WIDGETS, type DashboardWidgetConfig } from '../domain/analytics/dashboardLayout';

/** Toggle/reorder control for the Dashboard's widget layout (User Story 6, spec 019,
 *  FR-022/FR-025, contracts/dashboard-widgets.md). */
export function DashboardCustomizeSheet({
	layout,
	onChange,
	onReset
}: {
	layout: DashboardWidgetConfig[];
	onChange: (next: DashboardWidgetConfig[]) => void;
	onReset: () => void;
}) {
	const metaById = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

	function toggle(widgetId: string, visible: boolean) {
		onChange(layout.map((w) => (w.widgetId === widgetId ? { ...w, visible } : w)));
	}

	function move(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= layout.length) return;
		const next = [...layout];
		[next[index], next[target]] = [next[target], next[index]];
		onChange(next);
	}

	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button variant="outline" size="icon" aria-label="Customize dashboard">
					<Settings2 className="size-4" />
				</Button>
			</SheetTrigger>
			<SheetContent side="right" className="flex flex-col gap-4 overflow-y-auto p-4">
				<SheetHeader className="p-0">
					<SheetTitle>Customize dashboard</SheetTitle>
					<SheetDescription>Show, hide, and reorder your dashboard widgets.</SheetDescription>
				</SheetHeader>

				<ul className="flex flex-col gap-2">
					{layout.map((entry, i) => {
						const meta = metaById.get(entry.widgetId as (typeof DASHBOARD_WIDGETS)[number]['id']);
						if (!meta) return null;
						return (
							<li
								key={entry.widgetId}
								className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
							>
								<div className="flex flex-col">
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => move(i, -1)}
										disabled={i === 0}
										aria-label={`Move ${meta.title} up`}
									>
										<ChevronUp className="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => move(i, 1)}
										disabled={i === layout.length - 1}
										aria-label={`Move ${meta.title} down`}
									>
										<ChevronDown className="size-3.5" />
									</Button>
								</div>
								<span className="flex-1 text-sm">{meta.title}</span>
								<Switch
									checked={entry.visible}
									disabled={meta.core}
									onCheckedChange={(checked) => toggle(entry.widgetId, checked)}
									aria-label={`Show ${meta.title}`}
								/>
							</li>
						);
					})}
				</ul>

				<SheetFooter className="p-0">
					<Button variant="outline" onClick={onReset}>
						Reset to default
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
