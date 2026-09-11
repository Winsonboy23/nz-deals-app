<script setup lang="ts">
// 後台（docs/admin-spec.md）：只有 admins 表裡的 email 進得來，不是的話直接導回首頁。
// 只做中文、桌機為主（body.admin 把 App 的 480px 上限放寬）。
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AdminReview from '../components/admin/AdminReview.vue'
import AdminRuns from '../components/admin/AdminRuns.vue'
import AdminLive from '../components/admin/AdminLive.vue'
import AdminTaxonomy from '../components/admin/AdminTaxonomy.vue'
import AdminUsers from '../components/admin/AdminUsers.vue'
import AdminSettings from '../components/admin/AdminSettings.vue'
import { useAdmin } from '../composables/useAdmin'

const router = useRouter()
const { isAdmin } = useAdmin()
const tab = ref<'review' | 'runs' | 'live' | 'taxonomy' | 'users' | 'settings'>('review')

watch(
  isAdmin,
  (v) => {
    if (v === false) void router.replace('/')
  },
  { immediate: true },
)

onMounted(() => document.body.classList.add('admin'))
onUnmounted(() => document.body.classList.remove('admin'))
</script>

<template>
  <div class="screen" style="padding-bottom: 60px">
    <div v-if="isAdmin === null" class="pad sub muted" style="margin-top: 20px">檢查權限…</div>
    <template v-else-if="isAdmin">
      <div class="pad" style="margin-top: 8px">
        <RouterLink class="back" to="/me">‹ 我的</RouterLink>
        <div class="h1" style="margin-top: 4px">後台</div>
      </div>
      <div class="pad" style="margin-top: 14px">
        <div class="chips" style="margin-bottom: 16px">
          <button class="chip" :class="{ on: tab === 'review' }" @click="tab = 'review'">待審</button>
          <button class="chip" :class="{ on: tab === 'runs' }" @click="tab = 'runs'">每週報告</button>
          <button class="chip" :class="{ on: tab === 'live' }" @click="tab = 'live'">即時查價</button>
          <button class="chip" :class="{ on: tab === 'taxonomy' }" @click="tab = 'taxonomy'">分類</button>
          <button class="chip" :class="{ on: tab === 'users' }" @click="tab = 'users'">使用者</button>
          <button class="chip" :class="{ on: tab === 'settings' }" @click="tab = 'settings'">開關</button>
        </div>
        <AdminReview v-if="tab === 'review'" />
        <AdminRuns v-else-if="tab === 'runs'" />
        <AdminLive v-else-if="tab === 'live'" />
        <AdminTaxonomy v-else-if="tab === 'taxonomy'" />
        <AdminUsers v-else-if="tab === 'users'" />
        <AdminSettings v-else />
      </div>
    </template>
  </div>
</template>
