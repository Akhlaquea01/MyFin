import { useState } from 'react';

/** How many of `total` rows to render now, growing by `step` each time more are asked for. */
export function useShowMore(total: number, step: number) {
	const [shown, setShown] = useState(step);
	return {
		visible: Math.min(shown, total),
		hidden: Math.max(0, total - shown),
		showMore: () => setShown((current) => current + step)
	};
}
