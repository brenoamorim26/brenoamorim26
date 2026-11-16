import { readFile, writeFile } from 'node:fs/promises';

const owner = process.env.GITHUB_OWNER || 'brenoamorim26';
const token = process.env.GITHUB_TOKEN;
const readmePath = new URL('../../README.md', import.meta.url);
const startMarker = '<!-- PROFILE-AUTO-START -->';
const endMarker = '<!-- PROFILE-AUTO-END -->';

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} ao consultar ${url}`);
  }
  return response.json();
}

async function getPublicRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await getJson(`https://api.github.com/users/${owner}/repos?type=owner&per_page=100&page=${page}&sort=updated`);
    repositories.push(...batch);
    if (batch.length < 100) break;
  }
  return repositories.filter((repo) => repo.name.toLowerCase() !== owner.toLowerCase() && !repo.fork && !repo.archived);
}

async function getRootFiles(repository) {
  try {
    return await getJson(`https://api.github.com/repos/${owner}/${repository.name}/contents`);
  } catch (error) {
    console.warn(`Não foi possível ler arquivos de ${repository.name}: ${error.message}`);
    return [];
  }
}

async function readManifest(file) {
  if (!file?.download_url) return '';
  const response = await fetch(file.download_url);
  if (!response.ok) return '';
  return response.text();
}

const topicLabels = new Map([
  ['power-bi', 'Power BI'],
  ['powerbi', 'Power BI'],
  ['data-analysis', 'Análise de dados'],
  ['data-analytics', 'Data Analytics'],
  ['business-intelligence', 'Business Intelligence'],
  ['google-cloud', 'Google Cloud'],
  ['google-cloud-platform', 'Google Cloud Platform'],
  ['bigquery', 'BigQuery'],
  ['machine-learning', 'Machine Learning'],
  ['jupyter-notebook', 'Jupyter Notebook'],
  ['material-ui', 'MUI'],
  ['mui', 'MUI'],
]);

const dependencyLabels = new Map([
  ['@mui/material', 'MUI'],
  ['@mui/icons-material', 'MUI Icons'],
  ['react', 'React'],
  ['react-dom', 'React'],
  ['react-router-dom', 'React Router'],
  ['vite', 'Vite'],
  ['next', 'Next.js'],
  ['typescript', 'TypeScript'],
  ['tailwindcss', 'Tailwind CSS'],
  ['express', 'Express'],
  ['pandas', 'Pandas'],
  ['numpy', 'NumPy'],
  ['scikit-learn', 'scikit-learn'],
  ['django', 'Django'],
  ['flask', 'Flask'],
  ['fastapi', 'FastAPI'],
  ['streamlit', 'Streamlit'],
  ['google-cloud-bigquery', 'BigQuery'],
  ['pyspark', 'PySpark'],
  ['junit', 'JUnit'],
  ['spring-boot-starter', 'Spring Boot'],
  ['microsoft.entityframeworkcore', 'Entity Framework Core'],
]);

function addTechnology(technologies, label, repositoryName) {
  if (!technologies.has(label)) technologies.set(label, new Set());
  technologies.get(label).add(repositoryName);
}

async function inspectRepository(repository) {
  const [languages, files] = await Promise.all([
    getJson(`https://api.github.com/repos/${owner}/${repository.name}/languages`).catch((error) => {
      console.warn(`Não foi possível ler linguagens de ${repository.name}: ${error.message}`);
      return {};
    }),
    getRootFiles(repository),
  ]);

  const technologies = new Set((repository.topics || []).map((topic) => topicLabels.get(topic) || topic.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())));
  const fileNames = files.filter((file) => file.type === 'file').map((file) => file.name.toLowerCase());
  const name = repository.name.toLowerCase();

  if (/pow(e|er)bi/.test(name.replace(/[^a-z0-9]/g, '')) || fileNames.some((file) => /\.(pbix|pbit|pbip)$/.test(file))) technologies.add('Power BI');
  if (fileNames.some((file) => file.endsWith('.sql'))) technologies.add('SQL');
  if (fileNames.some((file) => file.endsWith('.dax'))) technologies.add('DAX');
  if (fileNames.some((file) => file.endsWith('.ipynb'))) technologies.add('Jupyter Notebook');
  if (fileNames.includes('dockerfile') || fileNames.includes('docker-compose.yml') || fileNames.includes('compose.yml')) technologies.add('Docker');
  if (fileNames.includes('package.json')) technologies.add('Node.js');
  if (fileNames.includes('requirements.txt') || fileNames.includes('pyproject.toml')) technologies.add('Python');
  if (fileNames.some((file) => file.endsWith('.csproj') || file.endsWith('.sln'))) technologies.add('.NET');
  if (fileNames.some((file) => file === 'pom.xml' || file === 'build.gradle' || file === 'build.gradle.kts')) technologies.add('Maven / Gradle');

  const manifests = files.filter((file) => ['package.json', 'requirements.txt', 'pyproject.toml', 'pom.xml', 'build.gradle'].includes(file.name.toLowerCase()));
  const manifestContents = await Promise.all(manifests.map(readManifest));
  const packageFile = files.find((file) => file.name.toLowerCase() === 'package.json');
  if (packageFile) {
    const packageText = manifestContents[manifests.indexOf(packageFile)];
    try {
      const packageJson = JSON.parse(packageText);
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      for (const dependency of Object.keys(dependencies)) {
        const label = dependencyLabels.get(dependency.toLowerCase());
        if (label) technologies.add(label);
      }
    } catch (error) {
      console.warn(`package.json inválido em ${repository.name}: ${error.message}`);
    }
  }

  for (let index = 0; index < manifests.length; index += 1) {
    const fileName = manifests[index].name.toLowerCase();
    const contents = manifestContents[index].toLowerCase();
    for (const [dependency, label] of dependencyLabels) {
      if (fileName !== 'package.json' && contents.includes(dependency)) technologies.add(label);
    }
    if (fileName === 'pom.xml' || fileName.startsWith('build.gradle')) technologies.add(fileName === 'pom.xml' ? 'Maven' : 'Gradle');
  }

  return { repository, languages: Object.keys(languages), technologies };
}

function renderSection(projects) {
  const languageProjects = new Map();
  const technologyProjects = new Map();

  for (const project of projects) {
    for (const language of project.languages) {
      if (!languageProjects.has(language)) languageProjects.set(language, new Set());
      languageProjects.get(language).add(project.repository.name);
    }
    for (const technology of project.technologies) addTechnology(technologyProjects, technology, project.repository.name);
  }

  const sortByProjectCount = (left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0], 'pt-BR');
  const languageList = [...languageProjects.entries()].sort(sortByProjectCount)
    .map(([language, repos]) => {
      const countLabel = `${repos.size}_projeto${repos.size === 1 ? '' : 's'}`;
      const altCount = repos.size === 1 ? 'projeto' : 'projetos';
      return `
  <img src="https://img.shields.io/badge/${encodeURIComponent(language.replaceAll(' ', '_'))}-${countLabel}-2f6f5e?style=flat-square" alt="${language}: ${repos.size} ${altCount}" />`;
    })
    .join('');
  const technologyList = [...technologyProjects.entries()].sort(sortByProjectCount)
    .map(([technology, repos]) => {
      const countLabel = `${repos.size}_projeto${repos.size === 1 ? '' : 's'}`;
      const altCount = repos.size === 1 ? 'projeto' : 'projetos';
      return `
  <img src="https://img.shields.io/badge/${encodeURIComponent(technology.replaceAll(' ', '_'))}-${countLabel}-d9775f?style=flat-square" alt="${technology}: ${repos.size} ${altCount}" />`;
    })
    .join('');
  const rows = projects
    .sort((left, right) => new Date(right.repository.pushed_at) - new Date(left.repository.pushed_at))
    .map(({ repository, languages, technologies }) => {
      const languageText = languages.length ? languages.join(', ') : 'Não detectada';
      const technologyText = [...technologies].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ') || 'Adicione topics no GitHub';
      return `| [${repository.name}](https://github.com/${owner}/${repository.name}) | ${languageText} | ${technologyText} |`;
    })
    .join('\n');
  const timestamp = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date());

  return `${startMarker}
#### Linguagens identificadas
${languageList || '\nAinda não há linguagens detectadas nos repositórios públicos.'}

#### Tecnologias identificadas
${technologyList || '\nAinda não há tecnologias detectadas. Adicione topics aos repositórios para complementar esta lista.'}

<details>
<summary>Ver ${projects.length} repositórios públicos analisados</summary>

| Projeto | Linguagens | Tecnologias identificadas |
| --- | --- | --- |
${rows}
</details>

_Atualizado automaticamente em ${timestamp} UTC. Novos repositórios públicos são incluídos em até seis horas._
${endMarker}`;
}

const repositories = await getPublicRepositories();
const projects = await Promise.all(repositories.map(inspectRepository));
const readme = await readFile(readmePath, 'utf8');

if (!readme.includes(startMarker) || !readme.includes(endMarker)) {
  throw new Error('Os marcadores PROFILE-AUTO-START e PROFILE-AUTO-END precisam existir no README.');
}

const markerStart = readme.indexOf(startMarker);
const markerEnd = readme.indexOf(endMarker, markerStart) + endMarker.length;
const currentSection = readme.slice(markerStart, markerEnd);
const nextSection = renderSection(projects);
const withoutTimestamp = (section) => section.replace(/_Atualizado automaticamente em .* UTC\._/, '_Atualizado automaticamente._');

if (withoutTimestamp(currentSection) === withoutTimestamp(nextSection)) {
  console.log('As linguagens e tecnologias não mudaram; README mantido sem novo commit.');
} else {
  const updatedReadme = `${readme.slice(0, markerStart)}${nextSection}${readme.slice(markerEnd)}`;
  await writeFile(readmePath, updatedReadme, 'utf8');
  console.log(`README atualizado com ${projects.length} repositórios públicos.`);
}