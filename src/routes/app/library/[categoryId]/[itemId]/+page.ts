import { error } from '@sveltejs/kit';
import { getItem } from '$lib/content/categories';
import { itemResources } from '$lib/content/resources';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const item = getItem(params.itemId);
	if (!item || item.categoryId !== params.categoryId) {
		error(404, 'No such Skill Hub item.');
	}
	return { item, resources: itemResources(item) };
};
