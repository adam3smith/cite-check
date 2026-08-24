import Alpine from 'alpinejs'
import { citeCheckApp, statusLabel, statusBadgeClass, LLM_MODELS } from './app'
import { buildAiFieldRows } from './lib/llm-tasks'
import './style.css'

// Register Alpine component
Alpine.data('citeCheckApp', citeCheckApp)

// Register helpers accessible in Alpine templates via $statusLabel / $statusBadgeClass
Alpine.magic('statusLabel', () => statusLabel)
Alpine.magic('statusBadgeClass', () => statusBadgeClass)
Alpine.magic('llmModels', () => LLM_MODELS)
Alpine.magic('aiFieldRows', () => buildAiFieldRows)

Alpine.start()
