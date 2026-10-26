import { useMemo, useState } from 'react';
import { SettingOutlined } from '@ant-design/icons';
import { Button, Checkbox, Empty, Input, Popover, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { DocumentIndex } from '../domain';

const STORAGE_KEY = 'enterprise-knowledge-hub-chunk-columns';

export interface ChunkTableRow {
  id: string;
  documentName: string;
  location: string;
  content: string;
  tokenCount: number;
  tags: DocumentIndex | null;
}

interface ColumnDef {
  key: string;
  title: string;
  group: '片段' | '标签';
  width: number;
  defaultVisible: boolean;
}

/** 一列对应一个字段。以后新增标签，只要在这里加一项。 */
const COLUMN_DEFS: ColumnDef[] = [
  { key: 'documentName', title: '来源文件', group: '片段', width: 180, defaultVisible: true },
  { key: 'location', title: '位置', group: '片段', width: 160, defaultVisible: true },
  { key: 'time', title: '时间', group: '标签', width: 200, defaultVisible: true },
  { key: 'version', title: '版本', group: '标签', width: 110, defaultVisible: true },
  { key: 'subject', title: '主体', group: '标签', width: 140, defaultVisible: true },
  { key: 'owner', title: '负责人', group: '标签', width: 160, defaultVisible: true },
  { key: 'visibility', title: '可见范围', group: '标签', width: 120, defaultVisible: true },
  { key: 'keywords', title: '关键词', group: '标签', width: 240, defaultVisible: true },
  { key: 'questions', title: '可能的问题', group: '标签', width: 280, defaultVisible: true },
  { key: 'content', title: '正文', group: '片段', width: 420, defaultVisible: true },
  { key: 'tokenCount', title: 'Token', group: '片段', width: 90, defaultVisible: false },
];

const DEFAULT_VISIBLE = COLUMN_DEFS.filter((column) => column.defaultVisible).map((column) => column.key);

function loadVisible() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_VISIBLE;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_VISIBLE;
    }
    const known = new Set(COLUMN_DEFS.map((column) => column.key));
    const picked = parsed.filter((key): key is string => typeof key === 'string' && known.has(key));
    return picked.length ? picked : DEFAULT_VISIBLE;
  } catch {
    return DEFAULT_VISIBLE;
  }
}

function cellText(row: ChunkTableRow, key: string) {
  if (key === 'documentName') {
    return row.documentName;
  }
  if (key === 'location') {
    return row.location;
  }
  if (key === 'content') {
    return row.content;
  }
  if (key === 'tokenCount') {
    return String(row.tokenCount);
  }
  const tags = row.tags;
  if (!tags) {
    return '';
  }
  if (key === 'keywords') {
    return tags.keywords.join(' ');
  }
  if (key === 'questions') {
    return tags.questions.join(' ');
  }
  const value = tags[key as keyof DocumentIndex];
  return typeof value === 'string' ? value : '';
}

function CellValue({ row, columnKey }: { row: ChunkTableRow; columnKey: string }) {
  const text = cellText(row, columnKey);
  if (!text) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  if (columnKey === 'keywords' && row.tags) {
    return (
      <Space size={4} wrap>
        {row.tags.keywords.map((keyword) => <Tag key={keyword}>{keyword}</Tag>)}
      </Space>
    );
  }
  if (columnKey === 'questions' && row.tags) {
    return (
      <Space orientation="vertical" size={2}>
        {row.tags.questions.map((question) => (
          <Typography.Text key={question} className="small-text">{question}</Typography.Text>
        ))}
      </Space>
    );
  }
  if (columnKey === 'content') {
    return <Typography.Paragraph className="chunk-body" ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>{text}</Typography.Paragraph>;
  }
  return <Typography.Text>{text}</Typography.Text>;
}

export default function ChunkColumnTable({ rows }: { rows: ChunkTableRow[] }) {
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadVisible);
  const [keyword, setKeyword] = useState('');

  const saveVisible = (next: string[]) => {
    const ordered = COLUMN_DEFS.map((column) => column.key).filter((key) => next.includes(key));
    const safe = ordered.length ? ordered : ['content'];
    setVisibleKeys(safe);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  };

  const visibleColumns = COLUMN_DEFS.filter((column) => visibleKeys.includes(column.key));
  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!query) {
      return rows;
    }
    return rows.filter((row) => visibleKeys.some((key) => cellText(row, key).toLocaleLowerCase('zh-CN').includes(query)));
  }, [keyword, rows, visibleKeys]);

  const columns: TableColumnsType<ChunkTableRow> = visibleColumns.map((column) => ({
    title: column.title,
    key: column.key,
    dataIndex: column.key === 'documentName' || column.key === 'location' || column.key === 'content' || column.key === 'tokenCount'
      ? column.key
      : undefined,
    width: column.width,
    fixed: column.key === 'documentName' ? 'left' : undefined,
    render: column.key === 'documentName' || column.key === 'location' || column.key === 'tokenCount'
      ? undefined
      : (_, record) => <CellValue row={record} columnKey={column.key} />,
  }));

  const toggle = (key: string, checked: boolean) => {
    if (!checked && visibleKeys.length === 1) {
      return;
    }
    saveVisible(checked ? [...visibleKeys, key] : visibleKeys.filter((item) => item !== key));
  };

  const picker = (
    <div className="column-picker">
      {(['片段', '标签'] as const).map((group) => (
        <div key={group} className="column-picker-group">
          <Typography.Text type="secondary" className="small-text">{group}</Typography.Text>
          <Space orientation="vertical" size={6}>
            {COLUMN_DEFS.filter((column) => column.group === group).map((column) => (
              <Checkbox
                key={column.key}
                checked={visibleKeys.includes(column.key)}
                onChange={(event) => toggle(column.key, event.target.checked)}
              >
                {column.title}
              </Checkbox>
            ))}
          </Space>
        </div>
      ))}
      <Button type="link" size="small" className="metadata-link" onClick={() => saveVisible(DEFAULT_VISIBLE)}>
        恢复默认
      </Button>
    </div>
  );

  return (
    <Space orientation="vertical" size={12} className="full-width">
      <div className="chunk-toolbar">
        <Input.Search
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="在当前显示的列里筛选"
          aria-label="筛选知识片段"
          className="chunk-filter"
        />
        <Popover trigger="click" placement="bottomRight" title="选择要显示的列" content={picker}>
          <Button icon={<SettingOutlined />}>显示列</Button>
        </Popover>
      </div>
      <Space size={6} wrap>
        {visibleColumns.map((column) => (
          <Tag
            key={column.key}
            closable={visibleColumns.length > 1}
            onClose={(event) => {
              event.preventDefault();
              toggle(column.key, false);
            }}
          >
            {column.title}
          </Tag>
        ))}
      </Space>
      <Table<ChunkTableRow>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        pagination={false}
        scroll={{ x: visibleColumns.reduce((total, column) => total + column.width, 0) }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={rows.length ? '没有符合筛选的片段' : '文档完成构建后显示知识片段'}
            />
          ),
        }}
      />
      <Typography.Text type="secondary" className="small-text">
        {keyword.trim() ? `显示 ${filtered.length} / ${rows.length} 条` : `共 ${rows.length} 条`}
        。点掉上方的列名即可隐藏，需要时再从「显示列」加回来。
      </Typography.Text>
    </Space>
  );
}
