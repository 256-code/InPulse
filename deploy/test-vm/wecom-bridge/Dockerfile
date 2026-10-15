FROM 127.0.0.1:5000/inpulse/api:0.1.0-20261015-d7407c7
COPY app /opt/wecom-bridge
WORKDIR /opt/wecom-bridge
USER 10001:10001
ENTRYPOINT ["node"]
CMD ["/opt/wecom-bridge/runner.mjs"]
