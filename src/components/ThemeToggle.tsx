import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Button } from './ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger
} from './ui/dropdown-menu';
import {
	setThemePreference,
	useResolvedTheme,
	useThemePreference,
	type ThemePreference
} from '../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor }
];

export function ThemeToggle({ className }: { className?: string }) {
	const preference = useThemePreference();
	// The button shows what is on screen, which for "System" is whichever the device picked.
	const ActiveIcon = useResolvedTheme() === 'dark' ? Moon : Sun;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="Change theme" className={className}>
					<ActiveIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36">
				<DropdownMenuRadioGroup
					value={preference}
					onValueChange={(value) => {
						const next = OPTIONS.find((option) => option.value === value);
						if (next) setThemePreference(next.value);
					}}
				>
					{OPTIONS.map(({ value, label, icon: Icon }) => (
						<DropdownMenuRadioItem key={value} value={value}>
							<Icon />
							{label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
