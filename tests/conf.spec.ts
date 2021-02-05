import { expect } from "chai";
import { NginxConfFile } from "../src";

describe("configuration editing", function () {
    describe("access", function () {
        it("top-level nodes", function (done) {
            NginxConfFile.createFromSource("foo bar;").then((file) => {
                expect(file).to.exist;
                expect(file.nginx)
                    .to.have.property("foo")
                    .be.an.instanceof(Array)
                    .have.length(1);
                expect(file.nginx.foo[0]).to.have.property("_name", "foo");
                expect(file.nginx.foo[0]).to.have.property("_value", "bar");
                done();
            });
        });

        it("nested nodes", (done) => {
            NginxConfFile.createFromSource(
                "upstream backend { servers { server 127.0.0.1:8080; } }"
            )
                .then((file) => {
                    expect(file).to.exist;
                    expect(file.nginx)
                        .to.have.property("upstream")
                        .be.an.instanceof(Array)
                        .have.length(1);
                    expect(file.nginx.upstream[0]).to.have.property(
                        "_name",
                        "upstream"
                    );
                    expect(file.nginx.upstream[0]).to.have.property(
                        "_value",
                        "backend"
                    );
                    expect(file.nginx.upstream[0])
                        .to.have.property("servers")
                        .be.an.instanceof(Array)
                        .have.length(1);
                    expect(file.nginx.upstream[0].servers[0]).have.property(
                        "_value",
                        ""
                    );
                    expect(file.nginx.upstream[0].servers[0])
                        .to.have.property("server")
                        .be.an.instanceof(Array)
                        .have.length(1);
                    expect(
                        file.nginx.upstream[0].servers[0].server[0]
                    ).to.have.property("_value", "127.0.0.1:8080");
                    done();
                })
                .catch((err) => done(err));
        });

        it("adding comments", (done) => {
            NginxConfFile.createFromSource("foo bar;")
                .then((file) => {
                    expect(file).to.exist;
                    expect(file.nginx)
                        .to.have.property("foo")
                        .be.an.instanceof(Array)
                        .have.length(1);
                    expect(file.nginx.foo[0]._comments).to.have.length(0);
                    file.nginx.foo[0]._comments.push("new comment");
                    expect(file.nginx.foo[0]._comments).to.have.length(1);
                    done();
                })
                .catch((err) => {
                    expect(err).to.not.exist;
                });
        });
    });
});
