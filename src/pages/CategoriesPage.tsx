import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Tags, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import type { Category } from '../domain/entities';

const categorySchema = z.object({
	name: z.string().trim().min(1, 'Category name is required.'),
	parentId: z.string()
});
type CategoryFormValues = z.infer<typeof categorySchema>;

// User Story 2 (P2): category management, hierarchical (FR-012).
export function CategoriesPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [categories, setCategories] = useState<Category[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm<CategoryFormValues>({
		resolver: zodResolver(categorySchema),
		defaultValues: { name: '', parentId: '' }
	});

	async function refresh() {
		setCategories(await CategoryRepository.list(key));
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const topLevel = categories.filter((c) => c.parentId === null);
	const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

	async function onSubmit(values: CategoryFormValues) {
		await CategoryRepository.create(key, {
			name: values.name,
			parentId: values.parentId || null
		});
		form.reset({ name: '', parentId: '' });
		setDialogOpen(false);
		toast.success(`${values.name} added`);
		await refresh();
	}

	async function remove(category: Category) {
		await CategoryRepository.softDelete(key, category.id);
		await refresh();
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus /> Add category
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>New category</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="category-name">Name</Label>
								<Input id="category-name" {...form.register('name')} />
								{form.formState.errors.name && (
									<p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="category-parent">Parent (optional)</Label>
								<Controller
									control={form.control}
									name="parentId"
									render={({ field }) => (
										<Select
											value={field.value || '__none__'}
											onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
										>
											<SelectTrigger id="category-parent" className="w-full">
												<SelectValue placeholder="Top level" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="__none__">Top level</SelectItem>
												{topLevel.map((parent) => (
													<SelectItem key={parent.id} value={parent.id}>
														{parent.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
							</div>
							<DialogFooter>
								<Button type="submit">Add category</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : categories.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Tags className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No categories yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-3">
					{topLevel.map((parent) => (
						<div key={parent.id}>
							<div className="flex items-center justify-between rounded-lg border bg-card px-4 py-2.5">
								<span className="font-medium">{parent.name}</span>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Delete ${parent.name}`}
									onClick={() => remove(parent)}
								>
									<X className="text-muted-foreground" />
								</Button>
							</div>
							{childrenOf(parent.id).length > 0 && (
								<div className="mt-2 ml-6 flex flex-col gap-2">
									{childrenOf(parent.id).map((child) => (
										<div
											key={child.id}
											className="flex items-center justify-between rounded-lg border px-4 py-2 text-sm"
										>
											<span>{child.name}</span>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Delete ${child.name}`}
												onClick={() => remove(child)}
											>
												<X className="text-muted-foreground" />
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
