// Ambient augmentation for the File System Access API surface this app's first user
// (autoBackupService.ts, spec 019) needs, beyond what this project's current TypeScript `dom`
// lib already declares (`FileSystemDirectoryHandle.getFileHandle`/`createWritable` etc. are
// already present; the permission-query methods and the global entry point are not yet).
export {};

declare global {
	interface FileSystemHandlePermissionDescriptor {
		mode?: 'read' | 'readwrite';
	}

	interface FileSystemHandle {
		queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
		requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
	}

	interface Window {
		showDirectoryPicker(options?: {
			mode?: 'read' | 'readwrite';
		}): Promise<FileSystemDirectoryHandle>;
	}
}
