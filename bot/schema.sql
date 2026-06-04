-- Schéma du bot Gan Prévoyance.
-- Base de connaissance assurance (FAQ + pages scrapées de ganprevoyance.fr) en
-- recherche sémantique pgvector + état des conversations WhatsApp.
-- Embeddings locaux e5-base (multilingual-e5-base), 768 dimensions.

create extension if not exists vector;

-- Chunks de la base de connaissance. Une page longue est découpée en plusieurs
-- chunks (meilleure précision de récupération). `kind` = 'faq' | 'page'.
create table if not exists kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  title       text,
  section     text,                          -- rubrique / fil d'Ariane
  kind        text not null default 'page',  -- 'faq' | 'page'
  chunk_index int  not null default 0,
  content     text not null,
  embedding   vector(768),                   -- e5-base
  scraped_at  timestamptz,
  created_at  timestamptz default now(),
  unique (url, chunk_index)
);

create index if not exists kb_chunks_kind_idx  on kb_chunks (kind);
create index if not exists kb_chunks_embed_idx on kb_chunks using hnsw (embedding vector_cosine_ops);

-- Recherche sémantique dans la base de connaissance (similarité cosinus).
create or replace function match_kb(
  query_embedding vector(768),
  match_count     int default 5
)
returns table (
  id uuid, url text, title text, section text, kind text,
  content text, similarity float
)
language sql stable
as $$
  select k.id, k.url, k.title, k.section, k.kind, k.content,
         1 - (k.embedding <=> query_embedding) as similarity
  from kb_chunks k
  where k.embedding is not null
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

-- Conversations : état par utilisateur WhatsApp (user_ns MessagingMe).
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  external_id text unique not null,
  messages    jsonb default '[]'::jsonb,     -- historique format OpenAI
  turns       int  default 0,                -- compteur de tours (persiste après pruning)
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);

create index if not exists conversations_updated_idx on conversations (updated_at desc);
