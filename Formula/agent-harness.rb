class AgentHarness < Formula
  desc "Performance layer for coding agents"
  homepage "https://github.com/TheElephantCoder/agent-harness"
  url "https://github.com/TheElephantCoder/agent-harness/archive/refs/tags/v0.3.1.tar.gz"
  sha256 "11939402c763a2c3eb694a419e728095e54ed6447fbb5a93d7d99f6522ac7672"
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
    assert_match "0.3.1", shell_output("#{bin}/harness --version")
    system bin/"harness", "doctor"
  end
end
