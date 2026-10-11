import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, ListChecks, Pencil, Plus, Trash2, Type, Wand2 } from 'lucide-react';
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
	isKeywordRule,
	type CategorizationRuleWithStatus
} from '../data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../data/dexie/merchantCategorySignalRepository';
import {
	applyAutoCategorization,
	listSuggestions as listCategorizationSuggestions,
	createKeywordPreviewer,
	setMerchantRule,
	type KeywordPreview
} from '../domain/categorization/resolveCategorization';
import { MIN_KEYWORD_LENGTH, validateKeyword } from '../domain/categorization/keywordMatching';
import type { Category, Merchant, MerchantAlias, Tag } from '../domain/entities';
import { categoryOptions } from '../domain/categories/categoryHierarchy';
import { buildCategoryLabels } from '../domain/categories/categoryHierarchy';

const ruleSchema = z
	.object({
		matchBy: z.enum(['merchant', 'keyword']),
		merchantId: z.string(),
		merchantAliasId: z.string(), // '' means "any alias of this merchant"
		keyword: z.string(),
		categoryId: z.string().min(1, 'Choose a category.'),
		tagsInput: z.string()
	})
	.superRefine((values, ctx) => {
		if (values.matchBy === 'merchant') {
			if (!values.merchantId) {
				ctx.addIssue({ code: 'custom', path: ['merchantId'], message: 'Choose a merchant.' });
			}
			return;
		}
		const validation = validateKeyword(values.keyword);
		if (!validation.ok) {
			ctx.addIssue({ code: 'custom', path: ['keyword'], message: validation.message });
		}
	});
type RuleFormValues = z.infer<typeof ruleSchema>;

const EMPTY_FORM: RuleFormValues = {
	matchBy: 'merchant',
	merchantId: '',
	merchantAliasId: '',
	keyword: '',
	categoryId: '',
	tagsInput: ''
};

/** What "apply to existing transactions" is applying: a merchant's rule, or one keyword rule. */
type ApplyTarget = { merchantId: string } | { keywordRuleId: string; keyword: string };

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
		defaultValues: EMPTY_FORM
	});
	const selectedMerchantId = form.watch('merchantId');
	const matchBy = form.watch('matchBy');
	const keywordValue = form.watch('keyword');
	// What the keyword being typed would catch among entries that are still uncategorized.
	const [preview, setPreview] = useState<KeywordPreview | null>(null);
	// One previewer per open dialog: it reads and decrypts the uncategorized entries once, on the
	// first keystroke, and every later keystroke is answered from memory.
	const previewerRef = useRef<ReturnType<typeof createKeywordPreviewer> | null>(null);

	async function refresh() {
		setLoading(true);
		try {
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
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load this page.');
		} finally {
			setLoading(false);
		}
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

	useEffect(() => {
		if (!dialogOpen) previewerRef.current = null; // the next open starts fresh
		if (!dialogOpen || matchBy !== 'keyword' || !validateKeyword(keywordValue).ok) {
			setPreview(null);
			return;
		}
		let cancelled = false;
		// Debounced: the user is still typing.
		const handle = setTimeout(() => {
			(previewerRef.current ??= createKeywordPreviewer(key))
				.preview(keywordValue)
				.then((result) => {
					if (!cancelled) setPreview(result);
				})
				.catch(() => {
					if (!cancelled) setPreview(null);
				});
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dialogOpen, matchBy, keywordValue]);

	function merchantName(id: string): string {
		return merchants.find((m) => m.id === id)?.name ?? id;
	}
	const categoryLabels = buildCategoryLabels(categories);
	function categoryName(id: string): string {
		return categoryLabels.get(id) ?? id;
	}
	function tagNames(ids: string[]): string {
		return ids
			.map((id) => tags.find((t) => t.id === id)?.name)
			.filter((name): name is string => Boolean(name))
			.join(', ');
	}

	function openCreateDialog() {
		setEditingRule(null);
		form.reset(EMPTY_FORM);
		setDialogOpen(true);
	}

	function openEditDialog(rule: CategorizationRuleWithStatus) {
		setEditingRule(rule);
		form.reset({
			matchBy: isKeywordRule(rule) ? 'keyword' : 'merchant',
			merchantId: isKeywordRule(rule) ? '' : rule.merchantId,
			merchantAliasId: rule.merchantAliasId ?? ANY_ALIAS,
			keyword: rule.keyword ?? '',
			categoryId: rule.categoryId,
			tagsInput: tagNames(rule.tagIds)
		});
		setDialogOpen(true);
	}

	/**
	 * A rule only ever affected entries recorded AFTER it was made, so a user who set up
	 * "Swiggy → Food" still saw their whole Swiggy history uncategorized and reasonably concluded
	 * the feature did nothing. This offers to catch the existing history up — never silently, and
	 * never touching an entry that already has a category.
	 */
	async function offerApplyToExisting(target: ApplyTarget, alwaysAsk = false) {
		const options =
			'merchantId' in target
				? { merchantId: target.merchantId }
				: { keywordRuleId: target.keywordRuleId };
		const subject =
			'merchantId' in target
				? `from ${merchantName(target.merchantId)}`
				: `whose description contains "${target.keyword}"`;
		try {
			const { updated: count } = await applyAutoCategorization(key, { ...options, dryRun: true });
			if (count === 0) {
				if (alwaysAsk) {
					toast.info(
						`No uncategorized transactions ${subject} to update. (Transactions that already have a category are never changed.)`
					);
				}
				return;
			}
			const ok = window.confirm(
				`${count} existing uncategorized ${count === 1 ? 'transaction' : 'transactions'} ${subject} can be filed using this rule. Apply it now? (Transactions that already have a category are left alone.)`
			);
			if (!ok) return;
			const { updated } = await applyAutoCategorization(key, options);
			toast.success(
				`Categorized ${updated} existing ${updated === 1 ? 'transaction' : 'transactions'}`
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update existing transactions.');
		}
	}

	async function onSubmit(values: RuleFormValues) {
		try {
			const tagNameList = values.tagsInput
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			const tagIds =
				tagNameList.length > 0
					? (
							await Promise.all(tagNameList.map((name) => TagRepository.getOrCreate(key, name)))
						).map((t) => t.id)
					: [];
			if (values.matchBy === 'keyword') {
				const saved = editingRule
					? await CategorizationRuleRepository.update(key, editingRule.id, {
							keyword: values.keyword,
							categoryId: values.categoryId,
							tagIds
						})
					: await CategorizationRuleRepository.create(key, {
							keyword: values.keyword,
							categoryId: values.categoryId,
							tagIds
						});
				setDialogOpen(false);
				toast.success(editingRule ? 'Rule updated' : 'Rule created');
				await refresh();
				await offerApplyToExisting({ keywordRuleId: saved.id, keyword: saved.keyword ?? '' });
				return;
			}

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
			// An alias-scoped rule can't be applied retroactively: which alias a past transaction
			// matched isn't recorded on it.
			if (!merchantAliasId) await offerApplyToExisting({ merchantId: values.merchantId });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save rule.');
		}
	}

	async function deleteRule(rule: CategorizationRuleWithStatus) {
		try {
			await CategorizationRuleRepository.softDelete(key, rule.id);
			toast.success('Rule deleted');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete rule.');
		}
	}

	async function promoteSuggestion(suggestion: { merchantId: string; categoryId: string }) {
		try {
			await setMerchantRule(key, suggestion.merchantId, suggestion.categoryId);
			toast.success('Suggestion promoted to a rule');
			await refresh();
			await offerApplyToExisting({ merchantId: suggestion.merchantId });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not promote suggestion.');
		}
	}

	async function resetSuggestion(merchantId: string) {
		try {
			await MerchantCategorySignalRepository.reset(key, merchantId);
			toast.success('Suggestion reset');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not reset suggestion.');
		}
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
							<div
								className="inline-flex self-start rounded-lg border p-0.5"
								role="radiogroup"
								aria-label="Rule type"
							>
								<Button
									type="button"
									size="sm"
									role="radio"
									aria-checked={matchBy === 'merchant'}
									variant={matchBy === 'merchant' ? 'secondary' : 'ghost'}
									disabled={!!editingRule && matchBy !== 'merchant'}
									onClick={() => form.setValue('matchBy', 'merchant')}
								>
									Match a merchant
								</Button>
								<Button
									type="button"
									size="sm"
									role="radio"
									aria-checked={matchBy === 'keyword'}
									variant={matchBy === 'keyword' ? 'secondary' : 'ghost'}
									disabled={!!editingRule && matchBy !== 'keyword'}
									onClick={() => form.setValue('matchBy', 'keyword')}
								>
									<Type /> Match description text
								</Button>
							</div>
							{matchBy === 'keyword' && (
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="rule-keyword">Description contains</Label>
									<Input
										id="rule-keyword"
										placeholder="e.g. swiggy"
										autoComplete="off"
										{...form.register('keyword')}
									/>
									<p className="text-xs text-muted-foreground">
										Matches any transaction whose description or merchant has a word starting with
										this text — ignoring case and punctuation, so “swiggy” also catches
										“UPI-SWIGGY-8812” and “Swiggy Instamart”. At least {MIN_KEYWORD_LENGTH} letters
										or digits. If several keywords match, the longest wins; a rule for the exact
										merchant always wins over a keyword.
									</p>
									{form.formState.errors.keyword && (
										<p className="text-sm text-destructive">
											{form.formState.errors.keyword.message}
										</p>
									)}
									{preview && (
										<div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
											{preview.count === 0 ? (
												<>No uncategorized transactions contain this yet.</>
											) : (
												<>
													<strong>{preview.count}</strong> uncategorized{' '}
													{preview.count === 1 ? 'transaction contains' : 'transactions contain'}{' '}
													this — e.g. {preview.samples.map((sample) => `“${sample}”`).join(', ')}
												</>
											)}
										</div>
									)}
								</div>
							)}
							{matchBy === 'merchant' && (
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
							)}
							{matchBy === 'merchant' && (
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
							)}
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
										{categoryOptions(categories).map(({ id, label }) => (
											<SelectItem key={id} value={id}>
												{label}
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
						<h2 className="mb-1 text-sm font-medium text-muted-foreground">Rules</h2>
						<p className="mb-3 text-xs text-muted-foreground">
							Checked in this order: a rule for the exact merchant, then a keyword rule (the longest
							matching keyword wins), then a learned suggestion. Anything you categorize yourself is
							never overridden.
						</p>
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
											<CardTitle className="flex items-center gap-2 text-base">
												{isKeywordRule(rule) ? rule.keyword : merchantName(rule.merchantId)}
												{isKeywordRule(rule) && <Badge variant="secondary">Keyword</Badge>}
											</CardTitle>
											<div className="flex items-center gap-1">
												{rule.isInvalid && (
													<Badge variant="destructive">
														<AlertTriangle className="size-3" /> Invalid
													</Badge>
												)}
												{!rule.merchantAliasId && !rule.isInvalid && (
													<Button
														variant="ghost"
														size="icon"
														onClick={() =>
															void offerApplyToExisting(
																isKeywordRule(rule)
																	? { keywordRuleId: rule.id, keyword: rule.keyword ?? '' }
																	: { merchantId: rule.merchantId },
																true
															)
														}
														aria-label="Apply rule to existing transactions"
														title="Apply to existing uncategorized transactions"
													>
														<ListChecks className="size-4" />
													</Button>
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
											{isKeywordRule(rule)
												? `Description contains "${rule.keyword}"`
												: rule.merchantAliasId
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
						<p className="mb-3 text-xs text-muted-foreground">
							Merchants you've confirmed into the same category several times in a row. A merchant
							that already has a rule never appears here — the rule always wins.
						</p>
						{suggestions.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No learned suggestions yet — confirm a merchant into the same category a few times
								in the Review Queue to build one.
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
