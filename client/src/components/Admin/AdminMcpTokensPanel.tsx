import { useState, useEffect } from 'react'
import { adminApi } from '../../api/client'
import { useToast } from '../shared/Toast'
import { Key, Trash2, User, Loader2 } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface AdminMcpToken {
  id: number
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
  user_id: number
  username: string
}

export default function AdminMcpTokensPanel() {
  const [tokens, setTokens] = useState<AdminMcpToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const toast = useToast()
  const { t, locale } = useTranslation()

  useEffect(() => {
    setIsLoading(true)
    adminApi.mcpTokens()
      .then(d => setTokens(d.tokens || []))
      .catch(() => toast.error(t('admin.mcpTokens.loadError')))
      .finally(() => setIsLoading(false))
  }, [])

  const handleDelete = async (id: number) => {
    try {
      await adminApi.deleteMcpToken(id)
      setTokens(prev => prev.filter(tk => tk.id !== id))
      setDeleteConfirmId(null)
      toast.success(t('admin.mcpTokens.deleteSuccess'))
    } catch {
      toast.error(t('admin.mcpTokens.deleteError'))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('admin.mcpTokens.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{t('admin.mcpTokens.subtitle')}</p>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card)' }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Key className="w-8 h-8" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{t('admin.mcpTokens.empty')}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2.5 text-xs font-medium border-b"
              style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
              <span>{t('admin.mcpTokens.tokenName')}</span>
              <span>{t('admin.mcpTokens.owner')}</span>
              <span className="text-right">{t('admin.mcpTokens.created')}</span>
              <span className="text-right">{t('admin.mcpTokens.lastUsed')}</span>
              <span></span>
            </div>
            {tokens.map((token, i) => (
              <div key={token.id}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 px-4 py-3"
                style={{ borderBottom: i < tokens.length - 1 ? '1px solid var(--border-primary)' : undefined }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{token.name}</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{token.token_prefix}...</p>
                </div>
                <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <User className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="whitespace-nowrap">{token.username}</span>
                </div>
                <span className="text-xs whitespace-nowrap text-right" style={{ color: 'var(--text-tertiary)' }}>
                  {new Date(token.created_at).toLocaleDateString(locale)}
                </span>
                <span className="text-xs whitespace-nowrap text-right" style={{ color: 'var(--text-tertiary)' }}>
                  {token.last_used_at ? new Date(token.last_used_at).toLocaleDateString(locale) : t('admin.mcpTokens.never')}
                </span>
                <button onClick={() => setDeleteConfirmId(token.id)}
                  className="p-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  style={{ color: 'var(--text-tertiary)' }} title={t('common.delete')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {deleteConfirmId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirmId(null) }}>
          <div className="rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4" style={{ background: 'var(--bg-card)' }}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('admin.mcpTokens.deleteTitle')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('admin.mcpTokens.deleteMessage')}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
                {t('common.cancel')}
              </button>
              <button onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
