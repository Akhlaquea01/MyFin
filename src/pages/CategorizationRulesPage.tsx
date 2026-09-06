import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import { MerchantRepository, MerchantAliasRepository } from '../data/dexie/merchantRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { TagRepository } from '../data/dexie/tagRepository';
import {
	CategorizationRuleRepository,
	type CategorizationRuleWithStatus
} from '../data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../data/dexie/merchantCategorySignalRepository';
import { listSuggestions as listCategorizationSuggestions } from '../domain/categorization/resolveCategorization';
import type { Category, Merchant, MerchantAlias, Tag } from '../domain/entities';

const ruleSchema = z.object({
	merchantId: z.string().min(1, 'Choose a merchant.'),
	merchantAliasId: z.string(), // '' means "any alias of this merchant"
	categoryId: z.string().min(1, 'Choose a category.'),
	tagsInput: z.string()
});
type RuleFormValues = z.infer<typeof ruleSchema>;

const ANY_ALIAS = '';

// Story 1 (P1): explicit merchant/alias -> category+tags rules. Story 3 (P3) extends this
// page with a "Learned Suggestions" section (promote/reset) once Story 2 lands.
export function CategorizationRulesPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [tags, setTags] = useState<Tag[]>([]);
	const [rules, setRules] = useState<CategorizationRuleWithStatus[]>([]);
	const [aliasesByMerchant, setAliasesByMerchant] = useState<Record<string, MerchantAlias[]>>({});
	const [suggestions, setSuggestions] = useState<{ merchantId: string; categoryId: string }[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<CategorizationRuleWithStatus | null>(null);

	const form = useForm<RuleFormValues>({
		resolver: zodResolver(ruleSchema),
		defaultValues: { merchantId: '', merchantAliasId: ANY_ALIAS, categoryId: '', tagsInput: '' }
	});
	const selectedMerchantId = form.watch('merchantId');

	async function refresh() {
		setLoading(true);
		const [allMerchants, allCategories, allTags, allRules, allSuggestions] = await Promise.all([
			MerchantRepository.list(key),
			CategoryRepository.list(key),
			TagRepository.list(key),
			CategorizationRuleRepository.list(key),
			listCategorizationSuggestions(key)
		]);
		setMerchants(allMerchants);
		setCategories(allCategories);
		setTags(allTags);
		setRules(allRules);
		setSuggestions(allSuggestions);
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!selectedMerchantId || aliasesByMerchant[selectedMerchantId]) return;
		void MerchantAliasRepository.listForMerchant(key, selectedMerchantId).then((aliases) => {
			setAliasesByMerchant((prev) => ({ ...prev, [selectedMerchantId]: aliases }));
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedMerchantId]);

	function merchantName(id: string): string {
		return merchants.find((m) => m.id === id)?.name ?? id;
	}
	function categoryName(id: string): string {
		return categories.find((c) => c.id === id)?.name ?? id;
	}
	function tagNames(ids: string[]): string {
		return ids
			.map((id) => tags.find((t) => t.id === id)?.name)
			.filter((name): name is string => Boolean(name))
			.join(', ');
	}

	function openCreateDialog() {
		setEditingRule(null);
		form.reset({ merchantId: '', merchantAliasId: ANY_ALIAS, categoryId: '', tagsInput: '' });
		setDialogOpen(true);
	}

	function openEditDialog(rule: CategorizationRuleWithStatus) {
		setEditingRule(rule);
		form.reset({
			merchantId: rule.merchantId,
			merchantAliasId: rule.merchantAliasId ?? ANY_ALIAS,
			categoryId: rule.categoryId,
			tagsInput: tagNames(rule.tagIds)
		});
		setDialogOpen(true);
	}

	async function onSubmit(values: RuleFormValues) {
		const tagNameList = values.tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		const tagIds =
			tagNameList.length > 0
				? (await Promise.all(tagNameList.map((name) => TagRepository.getOrCreate(key, name)))).map(
						(t) => t.id
					)
				: [];
		const merchantAliasId = values.merchantAliasId || null;

		if (editingRule) {
			await CategorizationRuleRepository.update(key, editingRule.id, {
				merchantId: values.merchantId,
				merchantAliasId,
				categoryId: values.categoryId,
				tagIds
			});
		} else {
			await CategorizationRuleRepository.create(key, {
				merchantId: values.merchantId,
				merchantAliasId,
				categoryId: values.categoryId,
				tagIds
			});
		}
		setDialogOpen(false);
		toast.success(editingRule ? 'Rule updated' : 'Rule created');
		await refresh();
	}

	async function deleteRule(rule: CategorizationRuleWithStatus) {
		await CategorizationRuleRepository.softDelete(key, rule.id);
		toast.success('Rule deleted');
		await refresh();
	}

	async function promoteSuggestion(suggestion: { merchantId: string; categoryId: string }) {
		await CategorizationRuleRepository.create(key, {
			merchantId: suggestion.merchantId,
			merchantAliasId: null,
			categoryId: suggestion.categoryId,
			tagIds: []
		});
		toast.success('Suggestion promoted to a rule');
		await refresh();
	}

	async function resetSuggestion(merchantId: string) {
		await MerchantCategorySignalRepository.reset(key, merchantId);
		toast.success('Suggestion reset');
		await refresh();
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Wand2 className="size-6 text-primary" />
					<h1 className="text-2xl font-semibold tracking-tight">Auto-Categorize</h1>
				</div>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button onClick={openCreateDialog}>
							<Plus /> Add rule
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{editingRule ? 'Edit rule' : 'New rule'}</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="rule-merchant">Merchant</Label>
								<Select
									value={form.watch('merchantId')}
									onValueChange={(v) => {
										form.setValue('merchantId', v);
										form.setValue('merchantAliasId', ANY_ALIAS);
									}}
								>
									<SelectTrigger id="rule-merchant" className="w-full">
										<SelectValue placeholder="Choose merchant…" />
									</SelectTrigger>
									<SelectContent>
										{merchants.map((m) => (
											<SelectItem key={m.id} value={m.id}>
												{m.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{form.formState.errors.merchantId && (
									<p className="text-sm text-destructive">
										{form.formState.errors.merchantId.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="rule-alias">Scope</Label>
								<Select
									value={form.watch('merchantAliasId')}
									onValueChange={(v) => form.setValue('merchantAliasId', v)}
									disabled={!selectedMerchantId}
								>
									<SelectTrigger id="rule-alias" className="w-full">
										<SelectValue placeholder="Any alias of this merchant" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ANY_ALIAS}>Any alias of this merchant</SelectItem>
										{(aliasesByMerchant[selectedMerchantId] ?? []).map((alias) => (
											<SelectItem key={alias.id} value={alias.id}>
												Only "{alias.aliasText}"
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="rule-category">Category</Label>
								<Select
									value={form.watch('categoryId')}
									onValueChange={(v) => form.setValue('categoryId', v)}
								>
									<SelectTrigger id="rule-category" className="w-full">
										<SelectValue placeholder="Choose category…" />
									</SelectTrigger>
									<SelectContent>
										{categories.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{form.formState.errors.categoryId && (
									<p className="text-sm text-destructive">
										{form.formState.errors.categoryId.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="rule-tags">Tags (comma-separated, optional)</Label>
								<Input id="rule-tags" {...form.register('tagsInput')} />
							</div>
							<DialogFooter>
								<Button type="submit">{editingRule ? 'Save changes' : 'Add rule'}</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : (
				<div className="flex flex-col gap-8">
					<section>
						<h2 className="mb-2 text-sm font-medium text-muted-foreground">Rules</h2>
						{rules.length === 0 ? (
							<Card className="border-dashed">
								<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
									<Wand2 className="size-8 text-muted-foreground" />
									<p className="text-sm text-muted-foreground">No rules yet.</p>
								</CardContent>
							</Card>
						) : (
							<div className="flex flex-col gap-3">
								{rules.map((rule) => (
									<Card key={rule.id}>
										<CardHeader className="flex items-start justify-between space-y-0 pb-2">
											<CardTitle className="text-base">{merchantName(rule.merchantId)}</CardTitle>
											<div className="flex items-center gap-1">
												{rule.isInvalid && (
													<Badge variant="destructive">
														<AlertTriangle className="size-3" /> Invalid
													</Badge>
												)}
												<Button
													variant="ghost"
													size="icon"
													onClick={() => openEditDialog(rule)}
													aria-label="Edit rule"
												>
													<Pencil className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => deleteRule(rule)}
													aria-label="Delete rule"
												>
													<Trash2 className="size-4" />
												</Button>
											</div>
										</CardHeader>
										<CardContent className="text-sm text-muted-foreground">
											{rule.merchantAliasId
												? `Only "${aliasesByMerchant[rule.merchantId]?.find((a) => a.id === rule.merchantAliasId)?.aliasText ?? rule.merchantAliasId}"`
												: 'Any alias'}{' '}
											→ {categoryName(rule.categoryId)}
											{rule.tagIds.length > 0 && <> · {tagNames(rule.tagIds)}</>}
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</section>

					<section>
						<h2 className="mb-2 text-sm font-medium text-muted-foreground">Learned Suggestions</h2>
						{suggestions.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No learned suggestions yet — confirm a merchant into the same category a few
								times in the Review Queue to build one.
							</p>
						) : (
							<div className="flex flex-col gap-3">
								{suggestions.map((s) => (
									<Card key={s.merchantId}>
										<CardContent className="flex items-center justify-between pt-6">
											<p className="text-sm">
												{merchantName(s.merchantId)} → {categoryName(s.categoryId)}
											</p>
											<div className="flex items-center gap-2">
												<Button size="sm" variant="outline" onClick={() => promoteSuggestion(s)}>
													Promote
												</Button>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => resetSuggestion(s.merchantId)}
												>
													Reset
												</Button>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</section>
				</div>
			)}
		</div>
	);
}
