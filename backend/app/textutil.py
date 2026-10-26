"""分词、Token 估算和查询清洗。Token 数用 cl100k 估算，只用于分块和上下文预算。"""

import logging
import re

import jieba
import tiktoken

jieba.setLogLevel(logging.ERROR)
_ENCODER = tiktoken.get_encoding("cl100k_base")
_STOPWORDS = set("的了和是在我有就都不也与及或而被把这那个一")
_FTS_UNSAFE = set('"*:(){}[]^')


def count_tokens(text: str) -> int:
    return len(_ENCODER.encode(text))


def encode_tokens(text: str) -> list[int]:
    return _ENCODER.encode(text)


def decode_tokens(tokens: list[int]) -> str:
    return _ENCODER.decode(tokens)


def search_tokens(text: str) -> list[str]:
    words = []
    for word in jieba.cut_for_search(text):
        cleaned = word.strip().lower()
        if len(cleaned) < 2 or cleaned in _STOPWORDS:
            continue
        if any(character in _FTS_UNSAFE for character in cleaned):
            continue
        words.append(cleaned)
    # 词典没收录的词（如“年假”紧挨着别的字）用二字片段补上，保证关键词还能命中。
    characters = [character for character in text if "\u4e00" <= character <= "\u9fff" and character not in _STOPWORDS]
    words.extend(left + right for left, right in zip(characters, characters[1:]))
    return list(dict.fromkeys(words))


def fts_match(text: str) -> str:
    tokens = search_tokens(text)[:30]
    if not tokens:
        return ""
    return " OR ".join(f'"{token}"' for token in tokens)


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
