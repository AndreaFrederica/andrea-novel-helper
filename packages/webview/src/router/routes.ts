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
    path: '/timeline-gantt',
    component: () => import('pages/TimelineGanttPage.vue'),
  },

  {
    path: '/editor-settings',
    component: () => import('pages/EditorSettingsPage.vue'),
  },

  {
    path: '/circle-packing',
    component: () => import('pages/CirclePackingPage.vue'),
  },

  {
    path: '/settings',
    component: () => import('pages/settingView/SettingsPage.vue'),
  },

  {
    path: '/editor-settings-enhanced',
    component: () => import('pages/editorSettingsEnhanced/EditorSettingsEnhancedPage.vue'),
  },

  {
    path: '/quick-settings',
    component: () => import('pages/quickSettings/QuickSettingsPage.vue'),
  },

  {
    path: '/whats-new',
    component: () => import('pages/whatsNew/WhatsNewPage.vue'),
  },

  {
    path: '/writing-dashboard',
    component: () => import('pages/WritingDashboardPage.vue'),
  },

  {
    path: '/writing-dashboard-widget/:id',
    component: () => import('pages/WritingDashboardWidgetPage.vue'),
  },

  {
    path: '/comments-manager',
    component: () => import('pages/CommentsManagerPage.vue'),
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
