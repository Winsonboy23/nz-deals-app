import { createRouter, createWebHashHistory } from 'vue-router'
// Eager so the product sheet can render over the home page even on a cold deep link.
import HomeView from './views/HomeView.vue'

/** Hash history so the build also works from a GitHub Pages sub-path. */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { tab: 'specials' } },
    { path: '/stores', name: 'stores', component: () => import('./views/StoresView.vue'), meta: { noTabs: true } },
    { path: '/browse', name: 'browse', component: () => import('./views/BrowseView.vue'), meta: { tab: 'browse' } },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { tab: 'browse' } },
    { path: '/recipes', name: 'recipes', component: () => import('./views/RecipesView.vue'), meta: { tab: 'recipes' } },
    { path: '/recipes/:id', name: 'recipe', component: () => import('./views/RecipeDetailView.vue'), meta: { tab: 'recipes' } },
    { path: '/ai-recipes', name: 'ai-recipes', component: () => import('./views/AiRecipesView.vue'), meta: { tab: 'list' } },
    { path: '/list', name: 'list', component: () => import('./views/ListView.vue'), meta: { tab: 'list' } },
    { path: '/me', name: 'me', component: () => import('./views/MeView.vue'), meta: { tab: 'me' } },
    { path: '/watching', name: 'watching', component: () => import('./views/WatchingView.vue'), meta: { tab: 'me' } },
    { path: '/signin', name: 'signin', component: () => import('./views/SignInView.vue'), meta: { tab: 'me' } },
    { path: '/s/:token', name: 'shared', component: () => import('./views/SharedListView.vue'), meta: { tab: 'list' } },
    { path: '/top10', name: 'top10', component: () => import('./views/Top10View.vue'), meta: { tab: 'specials' } },
    { path: '/half-price', name: 'half', component: () => import('./views/HalfPriceView.vue'), meta: { tab: 'specials' } },
    { path: '/fresh', name: 'fresh', component: () => import('./views/FreshView.vue'), meta: { tab: 'specials' } },
    { path: '/p/:key', name: 'product', component: () => import('./views/EmptyView.vue'), meta: { sheet: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, _from, saved) {
    if (to.meta.sheet) return false
    return saved ?? { top: 0 }
  },
})
