import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const plugin = vi.hoisted(() => ({
	checkPermissions: vi.fn(),
	requestPermissions: vi.fn(),
	createChannel: vi.fn(),
	schedule: vi.fn()
}));
const platform = vi.hoisted(() => ({ native: false }));

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: plugin }));
vi.mock('../../src/lib/native/platform', () => ({
	isNativeApp: () => platform.native,
	isNativePluginAvailable: () => platform.native
}));

import {
	getNotifyPermission,
	notificationId,
	requestNotifyPermission,
	showNotification
} from '../../src/lib/notify';

describe('notify — browser', () => {
	beforeEach(() => {
		platform.native = false;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports the Notification API state', async () => {
		vi.stubGlobal('Notification', { permission: 'default' });
		expect(await getNotifyPermission()).toBe('default');
		vi.stubGlobal('Notification', { permission: 'granted' });
		expect(await getNotifyPermission()).toBe('granted');
		vi.stubGlobal('Notification', { permission: 'denied' });
		expect(await getNotifyPermission()).toBe('denied');
	});

	it('is unsupported where there is no Notification API', async () => {
		vi.stubGlobal('Notification', undefined);
		expect(await getNotifyPermission()).toBe('unsupported');
		expect(await requestNotifyPermission()).toBe('unsupported');
		expect(await showNotification('t', 'b', 'k')).toBe(false);
	});

	it('asks through Notification.requestPermission', async () => {
		const requestPermission = vi.fn().mockResolvedValue('granted');
		vi.stubGlobal('Notification', { permission: 'default', requestPermission });
		expect(await requestNotifyPermission()).toBe('granted');
		expect(requestPermission).toHaveBeenCalled();
	});

	it('shows a browser notification with the tag as before', async () => {
		const ctor = vi.fn();
		vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'granted' }));
		expect(await showNotification('Rent due', 'Tomorrow', 'recurring:1')).toBe(true);
		expect(ctor).toHaveBeenCalledWith('Rent due', { body: 'Tomorrow', tag: 'recurring:1' });
	});

	it('reports failure instead of throwing when the constructor throws', async () => {
		vi.stubGlobal(
			'Notification',
			Object.assign(
				vi.fn(() => {
					throw new TypeError('Illegal constructor');
				}),
				{ permission: 'granted' }
			)
		);
		expect(await showNotification('t', 'b', 'k')).toBe(false);
	});
});

describe('notify — Android app', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		platform.native = true;
		plugin.createChannel.mockResolvedValue(undefined);
		plugin.schedule.mockResolvedValue({ notifications: [] });
	});

	it('maps the plugin permission states', async () => {
		plugin.checkPermissions.mockResolvedValueOnce({ display: 'granted' });
		expect(await getNotifyPermission()).toBe('granted');
		plugin.checkPermissions.mockResolvedValueOnce({ display: 'denied' });
		expect(await getNotifyPermission()).toBe('denied');
		plugin.checkPermissions.mockResolvedValueOnce({ display: 'prompt' });
		expect(await getNotifyPermission()).toBe('default');
		plugin.checkPermissions.mockResolvedValueOnce({ display: 'prompt-with-rationale' });
		expect(await getNotifyPermission()).toBe('default');
	});

	it('is unsupported when the plugin is missing', async () => {
		plugin.checkPermissions.mockRejectedValue(new Error('not implemented'));
		expect(await getNotifyPermission()).toBe('unsupported');
	});

	it('asks Android through the plugin', async () => {
		plugin.requestPermissions.mockResolvedValue({ display: 'granted' });
		expect(await requestNotifyPermission()).toBe('granted');
	});

	it('posts an immediate private-channel notification with a stable id', async () => {
		expect(await showNotification('Rent due', 'Tomorrow', 'recurring:1')).toBe(true);

		expect(plugin.createChannel).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'reminders', visibility: 0 })
		);
		const { notifications } = plugin.schedule.mock.calls[0][0];
		expect(notifications).toEqual([
			{
				id: notificationId('recurring:1'),
				title: 'Rent due',
				body: 'Tomorrow',
				channelId: 'reminders',
				autoCancel: true
			}
		]);
		// No `schedule` field: the plugin shows it right away rather than storing it to fire later.
		expect(notifications[0]).not.toHaveProperty('schedule');
	});

	it('reports failure instead of throwing when Android refuses', async () => {
		plugin.schedule.mockRejectedValue(new Error('permission denied'));
		expect(await showNotification('t', 'b', 'k')).toBe(false);
	});
});

describe('notificationId', () => {
	it('is stable, positive and fits in a 32-bit int', () => {
		const id = notificationId('budget:abc:2026-10');
		expect(id).toBe(notificationId('budget:abc:2026-10'));
		expect(Number.isInteger(id)).toBe(true);
		expect(id).toBeGreaterThanOrEqual(0);
		expect(id).toBeLessThanOrEqual(0x7fffffff);
	});

	it('differs between different reminders', () => {
		expect(notificationId('recurring:1')).not.toBe(notificationId('recurring:2'));
	});
});
