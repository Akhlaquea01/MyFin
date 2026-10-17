import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CategoryPicker } from '../../src/components/CategoryPicker';
import type { Category } from '../../src/domain/entities';

const category = (id: string, name: string, parentId: string | null = null): Category => ({
	id,
	name,
	parentId,
	icon: null,
	createdAt: 0,
	updatedAt: 0
});

const CATEGORIES = [
	category('food', 'Food'),
	category('groceries', 'Groceries', 'food'),
	category('dining', 'Dining out', 'food'),
	category('transport', 'Transport'),
	category('util', 'Utilities'),
	category('util-other', 'Other', 'util')
];

const NONE = { value: '__uncategorized__', label: 'Uncategorized' };

function Harness({
	initial = NONE.value,
	suggestedIds,
	onChange
}: {
	initial?: string;
	suggestedIds?: string[];
	onChange?: (value: string) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<>
			<label htmlFor="cat">Category</label>
			<CategoryPicker
				id="cat"
				value={value}
				onChange={(next) => {
					setValue(next);
					onChange?.(next);
				}}
				categories={CATEGORIES}
				noneOption={NONE}
				suggestedIds={suggestedIds}
				placeholder="Category…"
			/>
		</>
	);
}

function setMobile(isMobile: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: isMobile,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false
	}));
}

afterEach(() => vi.unstubAllGlobals());

describe('CategoryPicker', () => {
	it('shows the chosen label on a combobox button the label names', () => {
		render(<Harness initial="groceries" />);
		expect(screen.getByLabelText('Category')).toHaveTextContent('Food › Groceries');
		expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
	});

	it('shows the none option, or the placeholder for a value it does not know', () => {
		const { unmount } = render(<Harness />);
		expect(screen.getByLabelText('Category')).toHaveTextContent('Uncategorized');
		unmount();
		render(<Harness initial="deleted-category" />);
		expect(screen.getByLabelText('Category')).toHaveTextContent('Category…');
	});

	it('filters as you type and picks the row you click', async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<Harness onChange={onChange} />);

		await user.click(screen.getByLabelText('Category'));
		expect(screen.getAllByRole('option')).toHaveLength(CATEGORIES.length + 1); // + Uncategorized

		await user.type(screen.getByPlaceholderText('Type to search categories…'), 'gro');
		const options = screen.getAllByRole('option');
		expect(options.map((o) => o.textContent)).toEqual(['Food › Groceries']);

		await user.click(screen.getByRole('option', { name: 'Food › Groceries', exact: true }));
		expect(onChange).toHaveBeenCalledWith('groceries');
		expect(screen.getByLabelText('Category')).toHaveTextContent('Food › Groceries');
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	it('picks the first match with Enter, without touching the mouse', async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<Harness onChange={onChange} />);
		await user.click(screen.getByLabelText('Category'));
		await user.keyboard('trans{Enter}');
		expect(onChange).toHaveBeenCalledWith('transport');
	});

	it('matches the start of any word of the path, not the middle', async () => {
		const user = userEvent.setup();
		render(<Harness />);
		await user.click(screen.getByLabelText('Category'));
		const search = screen.getByPlaceholderText('Type to search categories…');

		await user.type(search, 'out');
		expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Food › Dining out']);

		await user.clear(search);
		await user.type(search, 'ood');
		expect(screen.queryAllByRole('option')).toHaveLength(0);
		expect(screen.getByText(/No category matches/)).toBeInTheDocument();
	});

	it('offers the none option only while the search is empty', async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<Harness initial="food" onChange={onChange} />);
		await user.click(screen.getByLabelText('Category'));
		await user.click(screen.getByRole('option', { name: 'Uncategorized' }));
		expect(onChange).toHaveBeenCalledWith('__uncategorized__');
	});

	it('lists suggestions first, once, under their own heading', async () => {
		const user = userEvent.setup();
		render(<Harness suggestedIds={['transport']} />);
		await user.click(screen.getByLabelText('Category'));

		const suggested = screen.getByRole('group', { name: 'Suggested' });
		expect(
			within(suggested)
				.getAllByRole('option')
				.map((o) => o.textContent)
		).toEqual(['Transport']);
		expect(screen.getAllByRole('option', { name: 'Transport', exact: true })).toHaveLength(1);
	});

	it('opens a bottom sheet with the same search on a phone', async () => {
		setMobile(true);
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<Harness onChange={onChange} />);

		await user.click(screen.getByLabelText('Category'));
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('Category')).toBeInTheDocument();

		await user.type(within(dialog).getByPlaceholderText('Type to search categories…'), 'util');
		await user.click(within(dialog).getByRole('option', { name: 'Utilities › Other' }));
		expect(onChange).toHaveBeenCalledWith('util-other');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('does not open when disabled', async () => {
		const user = userEvent.setup();
		render(
			<CategoryPicker value="" onChange={() => {}} categories={CATEGORIES} id="cat" disabled />
		);
		await user.click(screen.getByRole('combobox'));
		expect(screen.queryByRole('option')).not.toBeInTheDocument();
	});
});
