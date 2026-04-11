import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { REPO_CONFIG_FILENAME } from '@shared/config';
import type { RepoConfigRecord } from '@shared/schema';

export function ReposPage() {
  const [repos, setRepos] = useState<RepoConfigRecord[]>([]);
  const [selected, setSelected] = useState<RepoConfigRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRepos()
      .then((response) => {
        setRepos(response.repos);
        setSelected(response.repos[0] ?? null);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to load repositories.'));
  }, []);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>Installed repositories</h1>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="grid repo-grid">
        <div className="panel">
          <div className="list">
            {repos.map((repo) => (
              <button key={`${repo.owner}/${repo.repo}`} className="repo-row" type="button" onClick={() => setSelected(repo)}>
                <strong>{repo.owner}/{repo.repo}</strong>
                <span className="muted">{repo.configMissing ? 'Defaults only' : `Custom ${REPO_CONFIG_FILENAME}`}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          {selected ? (
            <>
              <h2>{selected.owner}/{selected.repo}</h2>
              <pre className="code-block">{selected.rawYaml ?? `# ${REPO_CONFIG_FILENAME} not found\n${JSON.stringify(selected.parsedJson, null, 2)}`}</pre>
              <h3>Merged config</h3>
              <pre className="code-block">{JSON.stringify(selected.parsedJson, null, 2)}</pre>
            </>
          ) : (
            <p className="muted">No repository config available yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
