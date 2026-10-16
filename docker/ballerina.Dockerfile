# Builds one Ballerina package with the Ballerina 2201.14.1 toolchain and runs it on Java 25.
#   SRC: the source folder (a package, or a workspace)   PKG: the package inside SRC to build
FROM ballerina/ballerina:2201.14.1 AS build
ARG SRC
ARG PKG=.
USER root
COPY ${SRC} /src
WORKDIR /src/${PKG}
RUN bal build && cp target/bin/*.jar /app.jar

FROM eclipse-temurin:25-jre
COPY --from=build /app.jar /app/app.jar
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
WORKDIR /app
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
