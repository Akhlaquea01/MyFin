import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SegmentedBar } from '../../src/components/charts/SegmentedBar';

describe('SegmentedBar', () => {
	it('describes the split for a screen reader and lists each part in the legend', () => {
		render(
			<SegmentedBar
				segments={[
					{ label: 'ready', value: 3, color: 'green' },
					{ label: 'need a look', value: 1, color: 'orange' }
				]}
			/>
		);
		expect(screen.getByRole('img', { name: '3 ready, 1 need a look' })).toBeInTheDocument();
		expect(screen.getByText('3 ready')).toBeInTheDocument();
		expect(screen.getByText('1 need a look')).toBeInTheDocument();
	});

	it('leaves out parts with nothing in them', () => {
		render(
			<SegmentedBar
				segments={[
					{ label: 'ready', value: 2, color: 'green' },
					{ label: 'need a category', value: 0, color: 'blue' }
				]}
			/>
		);
		expect(screen.queryByText(/need a category/)).not.toBeInTheDocument();
		expect(screen.getByRole('img', { name: '2 ready' })).toBeInTheDocument();
	});

	it('handles an empty bar without dividing by zero', () => {
		render(<SegmentedBar segments={[{ label: 'ready', value: 0, color: 'green' }]} />);
		expect(screen.getByRole('img', { name: 'Nothing to show' })).toBeInTheDocument();
	});

	it('writes values the way the caller asks', () => {
		render(
			<SegmentedBar
				segments={[{ label: 'spent', value: 1250, color: 'red' }]}
				format={(n) => `₹${n / 100}`}
			/>
		);
		expect(screen.getByText('₹12.5 spent')).toBeInTheDocument();
	});
});
