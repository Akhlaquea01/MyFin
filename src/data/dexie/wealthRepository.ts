import {
	db,
	type InvestmentHoldingRow,
	type InvestmentValuationRow,
	type LiabilityRow,
	type NetWorthSnapshotRow
} from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import type {
	InvestmentHolding,
	InvestmentValuation,
	Liability,
	LiabilityType,
	NetWorthSnapshot
} from '../../domain/entities';

export const InvestmentHoldingRepository = {
	async create(
		key: CryptoKey,
		input: { name: string; type: string; costBasis: number }
	): Promise<InvestmentHolding> {
		const now = Date.now();
		const holding: InvestmentHolding = {
			id: crypto.randomUUID(),
			name: input.name,
			type: input.type,
			costBasis: input.costBasis,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.investmentHoldings, key, holding, { deletedAt: NOT_DELETED });
		return holding;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		const existing = await getDecrypted<InvestmentHoldingRow, InvestmentHolding>(
			db.investmentHoldings,
			key,
			id
		);
		if (!existing) throw new Error(`InvestmentHolding ${id} not found`);
		const updated = { ...existing, deletedAt: Date.now(), updatedAt: Date.now() };
		await putEncrypted(db.investmentHoldings, key, updated, {
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
	},

	async list(key: CryptoKey): Promise<InvestmentHolding[]> {
		const rows = await db.investmentHoldings
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<InvestmentHoldingRow, InvestmentHolding>(key, rows);
	}
};

export const InvestmentValuationRepository = {
	async create(
		key: CryptoKey,
		input: { holdingId: string; date: string; value: number }
	): Promise<InvestmentValuation> {
		const now = Date.now();
		const valuation: InvestmentValuation = {
			id: crypto.randomUUID(),
			holdingId: input.holdingId,
			date: input.date,
			value: input.value,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.investmentValuations, key, valuation, {
			holdingId: valuation.holdingId,
			date: valuation.date
		});
		return valuation;
	},

	async listForHolding(key: CryptoKey, holdingId: string): Promise<InvestmentValuation[]> {
		const rows = await db.investmentValuations.where('holdingId').equals(holdingId).toArray();
		const valuations = await decryptRows<InvestmentValuationRow, InvestmentValuation>(key, rows);
		return valuations.sort((a, b) => (a.date < b.date ? 1 : -1));
	},

	/** The most recent valuation for a holding, or its cost basis if none recorded yet. */
	async latestValue(key: CryptoKey, holding: { id: string; costBasis: number }): Promise<number> {
		const valuations = await this.listForHolding(key, holding.id);
		return valuations[0]?.value ?? holding.costBasis;
	}
};

export const LiabilityRepository = {
	async create(
		key: CryptoKey,
		input: {
			name: string;
			type: LiabilityType;
			outstandingBalance: number;
			emiAmount: number | null;
			emiDueDay: number | null;
		}
	): Promise<Liability> {
		const now = Date.now();
		const liability: Liability = {
			id: crypto.randomUUID(),
			name: input.name,
			type: input.type,
			outstandingBalance: input.outstandingBalance,
			emiAmount: input.emiAmount,
			emiDueDay: input.emiDueDay,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.liabilities, key, liability, { deletedAt: NOT_DELETED });
		return liability;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Liability>): Promise<Liability> {
		const existing = await getDecrypted<LiabilityRow, Liability>(db.liabilities, key, id);
		if (!existing) throw new Error(`Liability ${id} not found`);
		const updated: Liability = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.liabilities, key, updated, {
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
		return updated;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async list(key: CryptoKey): Promise<Liability[]> {
		const rows = await db.liabilities.filter((row) => row.deletedAt === NOT_DELETED).toArray();
		return decryptRows<LiabilityRow, Liability>(key, rows);
	}
};

export const NetWorthSnapshotRepository = {
	async create(
		key: CryptoKey,
		input: { date: string; totalAssets: number; totalLiabilities: number; netWorth: number }
	): Promise<NetWorthSnapshot> {
		const now = Date.now();
		const snapshot: NetWorthSnapshot = {
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
			...input
		};
		await putEncrypted(db.netWorthSnapshots, key, snapshot, { date: snapshot.date });
		return snapshot;
	},

	async list(key: CryptoKey): Promise<NetWorthSnapshot[]> {
		const rows = await db.netWorthSnapshots.toArray();
		const snapshots = await decryptRows<NetWorthSnapshotRow, NetWorthSnapshot>(key, rows);
		return snapshots.sort((a, b) => (a.date < b.date ? -1 : 1));
	}
};
