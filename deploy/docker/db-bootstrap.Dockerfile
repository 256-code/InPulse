# syntax=docker/dockerfile:1
#
# 生产 PostgreSQL 18.6 bootstrap 镜像（技术设计 v1.2.2 §11.1 / §11.2.1）。
# 基于官方 postgres:18.6 digest 构建，安装评审基线 PGroonga 相关包（版本与
# keyring SHA 固定），并把经评审的角色/bootstrap SQL 放入
# `/docker-entrypoint-initdb.d/`。镜像内不包含任何密码；010_passwords.sql 在
# 首建库时从 `/run/secrets/*` 读取。
FROM postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280

ARG GROONGA_KEYRING_SHA256=91677bc2f9f454ef6ddfc6afe40764e470e60d8a6b1921661fd32ae5228537c8
ARG PGROONGA_DEBIAN_VERSION=4.0.8-1
ARG LIBGROONGA_DEBIAN_VERSION=16.1.0-1

RUN apt-get update \
 && apt-get install -y --only-upgrade libssl3t64 openssl openssl-provider-legacy \
 && apt-get install -y -V ca-certificates lsb-release wget postgresql-common \
 && wget -q -O /usr/share/keyrings/groonga-archive-keyring.asc https://packages.groonga.org/debian/groonga-archive-keyring.asc \
 && echo "${GROONGA_KEYRING_SHA256}  /usr/share/keyrings/groonga-archive-keyring.asc" | sha256sum -c - \
 && printf '%s\n' \
      'Types: deb deb-src' \
      'URIs: https://packages.groonga.org/debian/' \
      'Suites: trixie' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/groonga-archive-keyring.asc' \
    > /etc/apt/sources.list.d/groonga.sources \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get update \
 && apt-get install -y -V \
      postgresql-18-pgdg-pgroonga=${PGROONGA_DEBIAN_VERSION} \
      libgroonga0=${LIBGROONGA_DEBIAN_VERSION} \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /usr/local/bin/gosu

COPY database/bootstrap/000_roles.sql /docker-entrypoint-initdb.d/000_roles.sql
COPY database/bootstrap/010_passwords.sql /docker-entrypoint-initdb.d/010_passwords.sql
COPY database/bootstrap/020_pgroonga.sql /docker-entrypoint-initdb.d/020_pgroonga.sql
