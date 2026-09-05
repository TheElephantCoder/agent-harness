class AgentHarness < Formula
  desc "Performance layer for coding agents"
  homepage "https://github.com/TheElephantCoder/agent-harness"
  url "https://github.com/TheElephantCoder/agent-harness/archive/refs/tags/v0.1.2.tar.gz"
  sha256 "dd5339bdf6a1408b40aa0c6ad58984f83d044fd326a364e7f5457ddf4e4f780c"
  license "MIT"
  head "https://github.com/TheElephantCoder/agent-harness.git", branch: "main"

  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(prefix: false)
    system "npm", "run", "build"
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "0.1.1", shell_output("#{bin}/harness --version")
    system bin/"harness", "doctor"
  end
end
