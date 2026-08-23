import { error } from '@sveltejs/kit';
import { getCategory, ITEM_CATEGORIES } from '$lib/content/categories';
import type { PageLoad } from './$types';

/** The five pure-lesson categories (robot, core values, project, build,
 *  mechanisms) share this one list-and-detail pair. Missions, media, and the
 *  season documents each have their own dedicated route. */
export const load: PageLoad = ({ params }) => {
	const category = getCategory(params.categoryId);
	if (!category || category.kind !== 'items' || !ITEM_CATEGORIES.includes(category)) {
		error(404, 'No such Skill Hub category.');
	}
	return { category };
};
