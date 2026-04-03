import Alpine from 'alpinejs'
import { citeCheckApp, statusLabel, statusBadgeClass } from './app'
import './style.css'

// Register Alpine component
Alpine.data('citeCheckApp', citeCheckApp)

// Register helpers accessible in Alpine templates via $statusLabel / $statusBadgeClass
Alpine.magic('statusLabel', () => statusLabel)
Alpine.magic('statusBadgeClass', () => statusBadgeClass)

Alpine.start()
