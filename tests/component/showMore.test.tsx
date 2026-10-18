import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowMoreButton } from '../../src/components/ShowMoreButton';
import { useShowMore } from '../../src/hooks/useShowMore';

function List({ total, step }: { total: number; step: number }) {
	const paging = useShowMore(total, step);
	return (
		<>
			<ul>
				{Array.from({ length: total }, (_, i) => i)
					.slice(0, paging.visible)
					.map((i) => (
						<li key={i}>Row {i}</li>
					))}
			</ul>
			<ShowMoreButton hidden={paging.hidden} step={step} onClick={paging.showMore} />
		</>
	);
}

describe('Show more', () => {
	it('renders one page, then a page more each time it is asked for', async () => {
		const user = userEvent.setup();
		render(<List total={25} step={10} />);
		expect(screen.getAllByRole('listitem')).toHaveLength(10);

		await user.click(screen.getByRole('button', { name: 'Show 10 more (15 not shown)' }));
		expect(screen.getAllByRole('listitem')).toHaveLength(20);

		await user.click(screen.getByRole('button', { name: 'Show 5 more (5 not shown)' }));
		expect(screen.getAllByRole('listitem')).toHaveLength(25);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('offers nothing when the whole list fits on the first page', () => {
		render(<List total={10} step={10} />);
		expect(screen.getAllByRole('listitem')).toHaveLength(10);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('copes with an empty list', () => {
		render(<List total={0} step={10} />);
		expect(screen.queryAllByRole('listitem')).toHaveLength(0);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
