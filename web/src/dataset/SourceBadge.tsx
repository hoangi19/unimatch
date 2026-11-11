import { useI18n } from '../i18n'
import { Icon } from '../ui/Icon'
import { JOB_SOURCES, type JobSource } from './data'

const isKnown = (source: string): source is JobSource => (JOB_SOURCES as readonly string[]).includes(source)

export function SourceBadge({ source }: { source: string }) {
  const { t } = useI18n()
  return (
    <span className={`badge b-outline ds-src-${source}`}>
      {source === 'facebook_group' && <Icon name="facebook" />}
      {isKnown(source) ? t(`dataset.source.${source}`) : source}
    </span>
  )
}
