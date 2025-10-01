import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    // component: () => import('layouts/MainLayout.vue'),
    // children: [{ path: '', component: () => import('pages/IndexPage.vue') }],
    children: [{ path: '', component: () => import('pages/IndexPage.vue') }],
  },

  {
    path: '/roles-tree-view',
    component: () => import('pages/RolesTreeView.vue'),
  },

  {
    path: '/relation-graph',
    component: () => import('pages/RelationGraphPage.vue'),
  },

  {
    path: '/relationship-editor',
    component: () => import('pages/RelationshipEditorPage.vue'),
  },

  {
    path: '/timeline',
    component: () => import('pages/TimelinePage.vue'),
  },

  {
    path: '/editor-settings',
    component: () => import('pages/EditorSettingsPage.vue'),
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
