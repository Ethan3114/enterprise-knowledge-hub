import { Space, Tag } from 'antd';
import type { DocumentIndex } from '../domain';

/** 片段上的版本、可见范围和负责人。这些是标签，不是另一条正文。 */
export default function ChunkTags({ metadata }: { metadata?: DocumentIndex | null }) {
  if (!metadata) {
    return null;
  }
  const items = [
    metadata.version ? `版本 ${metadata.version}` : '',
    metadata.visibility ? `可见 ${metadata.visibility}` : '',
    metadata.owner || '',
  ].filter(Boolean);
  if (!items.length) {
    return null;
  }
  return (
    <Space size={4} wrap>
      {items.map((item) => (
        <Tag key={item}>{item}</Tag>
      ))}
    </Space>
  );
}
