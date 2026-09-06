import { db } from './db';
import type { UserProfile } from '../../domain/entities';

const PROFILE_ID = 'local-user' as const;

export const UserProfileRepository = {
	async get(): Promise<UserProfile | undefined> {
		return db.userProfile.get(PROFILE_ID);
	},

	async exists(): Promise<boolean> {
		return (await this.get()) !== undefined;
	},

	async create(profile: Omit<UserProfile, 'id'>): Promise<UserProfile> {
		const full: UserProfile = { id: PROFILE_ID, ...profile };
		await db.userProfile.add(full);
		return full;
	},

	async update(changes: Partial<Omit<UserProfile, 'id'>>): Promise<UserProfile> {
		await db.userProfile.update(PROFILE_ID, changes);
		const updated = await this.get();
		if (!updated) throw new Error('UserProfile does not exist; call create() first');
		return updated;
	}
};
