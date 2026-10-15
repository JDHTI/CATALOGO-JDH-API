#!/usr/bin/env bash
# Prepara este servidor para el CD de GitHub Actions. Idempotente; se corre
# una vez por paso, en orden (ver deploy/README.md → CI/CD):
#
#   deploy/scripts/setup-cicd.sh keys                  # deploy keys + ~/.ssh/config
#   deploy/scripts/setup-cicd.sh clones                # ~/apps/<repo> → clones git
#   deploy/scripts/setup-cicd.sh runner <url> <token>  # runner self-hosted (pide sudo)
#
# Las claves privadas nunca salen del servidor: `keys` imprime solo las
# públicas, para registrarlas en GitHub como deploy keys de solo lectura.
set -euo pipefail

ORG=JDHTI
REPOS=(CATALOGO-JDH-API CATALOGO-JDH-UI)
STACK_REPO=CATALOGO-JDH-API
APPS_DIR="$HOME/apps"
RUNNER_LABEL=tienda-jdh

lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
# GitHub no deja usar la misma deploy key en dos repos: una clave y un alias
# de host por repo (github-catalogo-jdh-api, ...).
host_alias() { echo "github-$(lower "$1")"; }
key_path() { echo "$HOME/.ssh/deploy_$(lower "${1//-/_}")"; }
remote_url() { echo "git@$(host_alias "$1"):$ORG/$1.git"; }

cmd_keys() {
  install -d -m 700 "$HOME/.ssh"
  touch "$HOME/.ssh/config" "$HOME/.ssh/known_hosts"
  chmod 600 "$HOME/.ssh/config"

  # Huellas de github.com desde su API (HTTPS), no un ssh-keyscan a ciegas.
  if ! ssh-keygen -F github.com >/dev/null; then
    curl -fsS https://api.github.com/meta \
      | grep -oE '"(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+"' \
      | tr -d '"' | sed 's/^/github.com /' >>"$HOME/.ssh/known_hosts"
  fi

  for repo in "${REPOS[@]}"; do
    local key alias
    key=$(key_path "$repo")
    alias=$(host_alias "$repo")
    [[ -f $key ]] || ssh-keygen -q -t ed25519 -N '' -C "tienda.jdh.local deploy $repo" -f "$key"
    if ! grep -qx "Host $alias" "$HOME/.ssh/config"; then
      printf '\nHost %s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' \
        "$alias" "$key" >>"$HOME/.ssh/config"
    fi
  done

  echo "Registrar cada clave en GitHub → repo → Settings → Deploy keys → Add"
  echo "deploy key (SIN marcar 'Allow write access'):"
  for repo in "${REPOS[@]}"; do
    echo
    echo "── $ORG/$repo"
    cat "$(key_path "$repo").pub"
  done
}

cmd_clones() {
  for repo in "${REPOS[@]}"; do
    local dir="$APPS_DIR/$repo" url
    url=$(remote_url "$repo")
    echo "▸ $repo"

    git ls-remote "$url" HEAD >/dev/null 2>&1 \
      || { echo "  Sin acceso a $url: falta registrar su deploy key" >&2; exit 1; }

    if [[ ! -d $dir/.git ]]; then
      mkdir -p "$dir"
      git -C "$dir" init -q -b master
      git -C "$dir" remote add origin "$url"
    else
      git -C "$dir" remote set-url origin "$url"
    fi
    git -C "$dir" fetch -q --prune origin

    if [[ $repo == "$STACK_REPO" ]] \
      && ! git -C "$dir" cat-file -e origin/master:deploy/compose.prod.yaml 2>/dev/null; then
      echo "  origin/master aún no trae deploy/: mergear primero el PR del stack" >&2
      exit 1
    fi

    # Una copia previa (tar) queda como árbol de trabajo de master. Lo que
    # difiera de origin/master se guarda en un stash en vez de pisarse; lo
    # ignorado (deploy/.env, deploy/caddy/ca/) no se toca.
    if ! git -C "$dir" rev-parse -q --verify HEAD >/dev/null; then
      git -C "$dir" update-ref refs/heads/master origin/master
      git -C "$dir" reset -q
    fi
    if [[ -n $(git -C "$dir" status --porcelain) ]]; then
      git -C "$dir" stash push -q -u -m "setup-cicd: copia previa $(date +%F)"
      echo "  Diferencias con origin/master guardadas en: git -C $dir stash list"
    fi
    git -C "$dir" checkout -q --force master
    git -C "$dir" reset -q --hard origin/master
    git -C "$dir" branch -q --set-upstream-to=origin/master master
    echo "  $(git -C "$dir" log --oneline -1)"
  done
}

cmd_runner() {
  local url=${1:?Falta la URL (https://github.com/$ORG o la de un repo)}
  local token=${2:?Falta el token de registro}
  # Un runner a nivel de org atiende los repos; a nivel de repo se necesita
  # uno por repo, cada uno en su carpeta.
  local dir="$HOME/actions-runner/${url##*/}"

  id -nG | grep -qw docker \
    || { echo "$USER no está en el grupo docker: el runner no podría desplegar" >&2; exit 1; }
  command -v flock >/dev/null || { echo "Falta flock (util-linux)" >&2; exit 1; }

  if [[ ! -x $dir/config.sh ]]; then
    local version
    version=$(curl -fsS https://api.github.com/repos/actions/runner/releases/latest \
      | grep -oE '"tag_name": *"v[0-9.]+"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
    mkdir -p "$dir"
    curl -fsSL "https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-x64-$version.tar.gz" \
      | tar -xz -C "$dir"
    sudo "$dir/bin/installdependencies.sh"
  fi

  cd "$dir"
  ./config.sh --unattended --replace \
    --url "$url" --token "$token" \
    --name "$(hostname)" --labels "$RUNNER_LABEL" --work _work
  sudo ./svc.sh install "$USER"
  sudo ./svc.sh start
  sudo ./svc.sh status | head -n 5
}

case ${1:-} in
  keys) cmd_keys ;;
  clones) cmd_clones ;;
  runner) shift; cmd_runner "$@" ;;
  *) sed -n '2,11p' "$0" >&2; exit 2 ;;
esac
